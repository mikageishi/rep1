// qa_data.json から「美容」「就活」関連のQ&Aを抽出し、
// 見出し付きMarkdown記事 article.md を生成する
const fs = require('fs');
const path = require('path');

const IN_FILE = path.join(__dirname, 'qa_data.json');
const OUT_FILE = path.join(__dirname, 'article.md');

const CATEGORIES = [
  {
    name: '美容',
    keywords: [
      '美容', 'コスメ', '化粧', 'メイク', 'スキンケア', '脱毛', '美白', '美肌',
      '整形', 'ニキビ', '洗顔', '日焼け', 'ヘアケア', '髪型', '美容院', '美容室',
      'パーマ', '縮毛', 'シャンプー', '香水', '眉毛', 'ムダ毛', '肌荒れ', '保湿',
      'アートメイク', 'ホワイトニング', '二重', 'クレンジング',
    ],
  },
  {
    name: '就活',
    keywords: [
      '就活', '就職', '面接', 'エントリーシート', '内定', '新卒', '採用',
      'インターン', '履歴書', '職務経歴', 'ガクチカ', '自己PR', '志望動機',
      'OB訪問', '会社説明会', '選考', 'リクルート',
    ],
  },
];

function matches(item, keywords) {
  const text = `${item.question || ''}\n${item.answer || ''}`;
  return keywords.some((kw) => text.includes(kw));
}

function formatDate(item) {
  // "2025年03月17日" 形式か "06月30日" 形式
  return item.date || item.questionDate || '日付不明';
}

const data = JSON.parse(fs.readFileSync(IN_FILE, 'utf-8'));
const items = data.items.filter((it) => it.question && it.answer);

const lines = [];
lines.push('# 御影石さんの質問箱まとめ：美容・就活編');
lines.push('');
lines.push(`> [querie.meの質問箱](${data.source})に寄せられた全${data.total}件のQ&Aから、「美容」「就活」に関連するものを抽出してまとめました（取得日: ${data.scrapedAt.slice(0, 10)}）。`);
lines.push('');

const used = new Set();
for (const cat of CATEGORIES) {
  const hits = items.filter((it) => !used.has(it.id) && matches(it, cat.keywords));
  hits.forEach((it) => used.add(it.id));
  lines.push(`## ${cat.name}に関するQ&A（${hits.length}件）`);
  lines.push('');
  if (hits.length === 0) {
    lines.push(`${cat.name}に関連する質問は見つかりませんでした。`);
    lines.push('');
    continue;
  }
  hits.forEach((it, i) => {
    const title = (it.question || '').replace(/\s+/g, ' ').slice(0, 40);
    lines.push(`### ${cat.name} Q${i + 1}. ${title}${(it.question || '').length > 40 ? '…' : ''}`);
    lines.push('');
    lines.push(`**質問**（${formatDate(it)}）`);
    lines.push('');
    lines.push(it.question.split('\n').map((l) => `> ${l}`).join('\n'));
    lines.push('');
    lines.push('**回答**');
    lines.push('');
    lines.push(it.answer.split('\n').map((l) => `> ${l}`).join('\n'));
    lines.push('');
    lines.push(`[元のQ&Aを見る](${it.url})`);
    lines.push('');
  });
}

lines.push('---');
lines.push('');
lines.push(`*この記事は qa_data.json（全${data.total}件）からキーワードマッチで自動生成されました。*`);
lines.push('');

fs.writeFileSync(OUT_FILE, lines.join('\n'), 'utf-8');
const counts = CATEGORIES.map((c) => c.name).join('・');
console.log(`生成完了: ${OUT_FILE}（対象カテゴリ: ${counts}）`);
