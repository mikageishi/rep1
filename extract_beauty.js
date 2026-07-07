// qa_data.json から美容関連キーワードを含む項目のみを抽出し、
// beauty_qa_data.json として保存する
const fs = require('fs');
const path = require('path');

const IN_FILE = path.join(__dirname, 'qa_data.json');
const OUT_FILE = path.join(__dirname, 'beauty_qa_data.json');

const KEYWORDS = [
  '肌', 'ニキビ', '整形', '二重', '鼻', '脱毛', '髭', 'スキンケア',
  'コスメ', 'メイク', '化粧水', 'クリニック', '美容', '垢抜け', 'ファッション',
];

function matches(item) {
  const text = `${item.question || ''}\n${item.answer || ''}`;
  return KEYWORDS.some((kw) => text.includes(kw));
}

const data = JSON.parse(fs.readFileSync(IN_FILE, 'utf-8'));
const hits = data.items.filter((it) => it.question && it.answer && matches(it));

const output = {
  source: data.source,
  scrapedAt: data.scrapedAt,
  keywords: KEYWORDS,
  total: hits.length,
  items: hits,
};

fs.writeFileSync(OUT_FILE, JSON.stringify(output, null, 2), 'utf-8');
console.log(`生成完了: ${OUT_FILE}（全${data.total}件中 ${hits.length}件が該当）`);
