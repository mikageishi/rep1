// querie.me Q&A scraper
// 1. /recent ページを最後まで自動スクロールして全回答リンクを収集
// 2. 各 /answer/<id> ページから質問文・回答文を取得
// 3. qa_data.json に保存
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const USER_ID = 'cA2DTQN5gzZHMU6GuR3Wj8XKxPyp';
const LIST_URL = `https://querie.me/user/${USER_ID}/recent`;
const OUT_FILE = path.join(__dirname, 'qa_data.json');
const CHECKPOINT = path.join(__dirname, '.qa_checkpoint.json');

// プロキシのTLS終端がChromeのTLS1.3 ClientHelloを処理できないため
// TLS1.2上限で接続する(証明書検証は有効なまま)
const LAUNCH_OPTS = {
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  proxy: process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY } : undefined,
  args: ['--ssl-version-max=tls1.2'],
};

const AD_HOSTS = /googlesyndication|doubleclick|adservice|google-analytics|googletagmanager|googletagservices|amazon-adsystem|adsbygoogle|fundingchoices/;

async function blockNoise(context) {
  await context.route('**/*', (route) => {
    const req = route.request();
    const type = req.resourceType();
    if (type === 'image' || type === 'media' || type === 'font') return route.abort();
    if (AD_HOSTS.test(req.url())) return route.abort();
    return route.continue();
  });
}

async function collectLinks(browser) {
  const context = await browser.newContext();
  await blockNoise(context);
  const page = await context.newPage();
  console.log('一覧ページを開いています:', LIST_URL);
  await page.goto(LIST_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('a[href^="/answer/"]', { timeout: 30000 });

  let stable = 0;
  let prevCount = 0;
  let rounds = 0;
  // 新しいカードが増えなくなるまでスクロール
  while (stable < 10) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(1200);
    const count = await page.evaluate(() => document.querySelectorAll('a[href^="/answer/"]').length);
    if (count === prevCount) {
      stable++;
    } else {
      stable = 0;
      prevCount = count;
    }
    rounds++;
    if (rounds % 10 === 0) console.log(`  スクロール ${rounds} 回目: ${count} 件`);
  }
  console.log(`スクロール完了: 全 ${prevCount} 件の回答リンクを検出`);

  const items = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('a[href^="/answer/"]')).map((a) => {
      const dateEl = a.querySelector('p.text-red-700');
      const tags = Array.from(a.querySelectorAll('p.text-slate-800')).map((p) => p.textContent.trim());
      const qEl = a.querySelector('div.whitespace-pre-line');
      return {
        id: a.getAttribute('href').replace('/answer/', ''),
        url: 'https://querie.me' + a.getAttribute('href'),
        listDate: dateEl ? dateEl.textContent.trim() : null,
        tags,
        question: qEl ? qEl.textContent.trim() : null,
      };
    });
  });
  await context.close();
  // 重複除去
  const seen = new Set();
  return items.filter((it) => (seen.has(it.id) ? false : (seen.add(it.id), true)));
}

async function fetchAnswer(context, item, attempt = 1) {
  const page = await context.newPage();
  try {
    await page.goto(item.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForSelector('div.my-2.whitespace-pre-line', { timeout: 20000 });
    const data = await page.evaluate(() => {
      // メインカード: 質問・回答とも my-2 whitespace-pre-line (一覧カードは mb-2)
      const blocks = Array.from(document.querySelectorAll('div.my-2.whitespace-pre-line'));
      const dates = Array.from(document.querySelectorAll('p.text-red-700')).map((p) => p.textContent.trim());
      return {
        question: blocks[0] ? blocks[0].textContent.trim() : null,
        answer: blocks[1] ? blocks[1].textContent.trim() : null,
        questionDate: dates[0] || null,
        answerDate: dates[1] || null,
      };
    });
    return { ...item, ...data };
  } catch (e) {
    if (attempt < 3) {
      await page.close().catch(() => {});
      await new Promise((r) => setTimeout(r, 2000 * attempt));
      return fetchAnswer(context, item, attempt + 1);
    }
    console.log(`  取得失敗 (${item.id}): ${e.message.split('\n')[0]}`);
    return { ...item, question: item.question, answer: null, error: e.message.split('\n')[0] };
  } finally {
    await page.close().catch(() => {});
  }
}

(async () => {
  const browser = await chromium.launch(LAUNCH_OPTS);

  let links;
  let done = {};
  if (fs.existsSync(CHECKPOINT)) {
    const cp = JSON.parse(fs.readFileSync(CHECKPOINT, 'utf-8'));
    links = cp.links;
    done = cp.done || {};
    console.log(`チェックポイントから再開: リンク ${links.length} 件 / 取得済 ${Object.keys(done).length} 件`);
  } else {
    links = await collectLinks(browser);
    fs.writeFileSync(CHECKPOINT, JSON.stringify({ links, done: {} }));
  }

  const context = await browser.newContext();
  await blockNoise(context);

  const pending = links.filter((l) => !done[l.id]);
  console.log(`回答ページ取得: 残り ${pending.length} / 全 ${links.length} 件`);
  const CONCURRENCY = 4;
  let processed = 0;
  for (let i = 0; i < pending.length; i += CONCURRENCY) {
    const batch = pending.slice(i, i + CONCURRENCY);
    const results = await Promise.all(batch.map((item) => fetchAnswer(context, item)));
    for (const r of results) done[r.id] = r;
    processed += batch.length;
    if (processed % 20 < CONCURRENCY || processed === pending.length) {
      console.log(`  進捗: ${processed}/${pending.length}`);
      fs.writeFileSync(CHECKPOINT, JSON.stringify({ links, done }));
    }
  }
  fs.writeFileSync(CHECKPOINT, JSON.stringify({ links, done }));

  // 一覧順(新しい順)で出力
  const qa = links.map((l) => done[l.id]).filter(Boolean);
  const output = {
    source: LIST_URL,
    scrapedAt: new Date().toISOString(),
    total: qa.length,
    items: qa.map((q) => ({
      id: q.id,
      url: q.url,
      date: q.answerDate || q.listDate,
      questionDate: q.questionDate,
      tags: q.tags,
      question: q.question,
      answer: q.answer,
    })),
  };
  fs.writeFileSync(OUT_FILE, JSON.stringify(output, null, 2), 'utf-8');
  const failed = qa.filter((q) => !q.answer).length;
  console.log(`保存完了: ${OUT_FILE} (全 ${qa.length} 件, 回答取得失敗 ${failed} 件)`);
  await browser.close();
})().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
