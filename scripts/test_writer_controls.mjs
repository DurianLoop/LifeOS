import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source = readFileSync(new URL('../app/v012.js', import.meta.url), 'utf8');
const pageCss = readFileSync(new URL('../app/writer-page.css', import.meta.url), 'utf8');
const html = readFileSync(new URL('../app/index.html', import.meta.url), 'utf8');

assert.doesNotMatch(source, /data-cell-style|data-cell-formatbar|cellFormatMarkup|i2FocusToolbarLead|正在写这一格/);
assert.match(source, /style:'paper'/);
assert.match(source, /style:'paper',frame:cleanDeskFrame/);
assert.match(source, /i2CellStyle-paper/);
assert.match(pageCss, /#writerPrevDay, #writerNextDay, #writerToday\),[\s\S]*?align-items: center/);
assert.match(pageCss, /#writerDateJump \{[\s\S]*?align-items: center/);
assert.match(html, /v012-writer-desk\.css\?v=4/);
assert.match(html, /writer-page\.css\?v=3/);
assert.match(html, /v012\.js\?v=15/);

console.log('writer controls contract: PASS');
