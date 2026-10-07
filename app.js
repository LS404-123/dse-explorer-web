'use strict';
const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const percent = value => value == null ? '未提供' : `${Math.round(value * 100)}%`;
const paperLabel = q => q.paper === 2 ? `Paper 2 · ${q.elective} · ` : '';
const normalize = value => String(value).normalize('NFKC').toLowerCase();
const defaults = {search:'',book:'',topic:'',kind:'MC',year:'',difficulty:'',sort:'oldest',question:'',tab:'scan',panel:'open'};
const difficultyLevels = ['容易','中等','困難','資料不足'];
const searchKind = query => query.match(/\b(MC|LQ)\b/i)?.[1].toUpperCase();
let state = {...defaults};
let filtered = [];
let answerQuestion = '';
let collapsedBook = '';
let data = window.DSE_DATA;
const usagePrefix = 'dse-explorer:used:';
const usageParts = detail => detail.usageParts || [detail.part];
const usageKeys = q => q.kind === 'MC' ? [q.id] : [...new Set(q.details.flatMap(d => usageParts(d).map(part => `${q.id}:${part}`)))];
let usedQuestions = new Set();
let usageAvailable = true;
let usageMessage = '';
const hosted = /^https?:$/.test(location.protocol);
const cloud = hosted && window.DSE_CLOUD;
let cloudUser = null;
let cloudBusy = false;
const manualDifficultyPrefix = 'dse-explorer:difficulty:';
let manualDifficulties = new Map();
let difficultyAvailable = true;
let difficultyMessage = '';
const difficultyKey = (q, d) => `${q.id}:${d.part}`;
const difficultyLevel = (q, d) => d.difficulty?.level || manualDifficulties.get(difficultyKey(q,d)) || '資料不足';
window.DSE_COPY_IMAGES = Object.create(null);
let topicOrder = data?.topicOrder || {};
let canonicalTopics = new Set(Object.values(topicOrder).flat());
history.scrollRestoration = 'manual';

function emphasizePhysics(value) {
  const terms = /(比熱容量|熱容量|比潛熱|潛熱|內能|溫差|溫度|熱量|光子能量|能量|功率|質量虧損|質量|密度|壓強|壓力|體積|最大速率|角速度|加速度|速率|速度|位移|距離|動量|動能|勢能|機械能|力矩|張力|摩擦力|向心力|引力|合力|淨力|波長|頻率|週期|振幅|波速|折射率|臨界角|入射角|折射角|電流|電壓|電阻|電動勢|電勢差|電勢|電荷|電場強度|電場|磁場強度|磁通量|磁通密度|磁場|半衰期|活度|結合能|功函數|電離能|能級|響度|聲強|效率|焦距|放大率|[^\p{Script=Han}；，。\n<>]*[=＝∝][^\p{Script=Han}；，。\n<>]*)/gu;
  return String(value ?? '').split(terms).map((text,index) => index % 2 ? `<strong class="physics-emphasis">${esc(text)}</strong>` : esc(text)).join('');
}

const rateRanges = {missing:'未提供答對率',low:'答對率低於 40%',medium:'答對率 40–59%',good:'答對率 60–79%',high:'答對率 80% 或以上'};
function rateBand(value) {
  const n = value == null ? null : Math.round(value * 100);
  return n == null ? 'missing' : n < 40 ? 'low' : n < 60 ? 'medium' : n < 80 ? 'good' : 'high';
}
function rateHTML(value) {
  const band = rateBand(value);
  return `<span class="rate-badge rate-${band}" title="${rateRanges[band]}">${percent(value)}</span>`;
}

function loadUsage() {
  try {
    usedQuestions = new Set(data.questions.flatMap(usageKeys).filter(key => localStorage.getItem(usagePrefix + key) === '1'));
    usageAvailable = true;
    usageMessage = '';
  } catch {
    usageAvailable = false;
    usageMessage = '未能讀取使用紀錄，暫時無法勾選。請允許瀏覽器儲存資料後重新整理。';
  }
}

function usageSummary(q) {
  if (!usageAvailable) return '紀錄未能讀取';
  const keys = usageKeys(q), count = keys.filter(key => usedQuestions.has(key)).length;
  return q.kind === 'MC' ? (count ? '已使用' : '未使用') : `已用 ${count}/${keys.length} 個已列分題`;
}

function usageCheckboxHTML(q, part, showPart = false) {
  const key = part == null ? q.id : `${q.id}:${part}`;
  const label = esc(`${q.year} ${paperLabel(q)}${q.kind} 第 ${q.label} 題${part == null ? '' : ' '+part} 已使用`);
  const text = part == null ? '已使用' : showPart ? esc(part) : '';
  return `<label class="usage-toggle${part == null ? '' : ' usage-compact'}" title="${label}"><input type="checkbox" data-used="${esc(key)}" aria-label="${label}" ${usedQuestions.has(key) ? 'checked' : ''} ${usageAvailable && !cloudBusy ? '' : 'disabled'}>${text ? `<span>${text}</span>` : ''}</label>`;
}

function usageNote() {
  return usageMessage || (hosted ? '使用紀錄儲存在雲端；長題按已列出的分題記錄。' : '使用紀錄儲存在此瀏覽器；長題按已列出的分題記錄。');
}

function syncUsage() {
  document.querySelectorAll('input[data-used]').forEach(input => {
    input.checked = usedQuestions.has(input.dataset.used);
    input.disabled = !usageAvailable || cloudBusy;
  });
  if ($('usage-message')) $('usage-message').textContent = usageNote();
  if (hosted) {
    $('cloud-button').textContent = cloudUser ? '同步設定' : '登入同步';
    $('cloud-status').textContent = cloudBusy ? '正在同步…' : usageMessage || `雲端已使用 ${usedQuestions.size} 筆`;
    $('cloud-login').hidden = !!cloudUser;
    $('cloud-account').hidden = !cloudUser;
    $('cloud-user').textContent = cloudUser?.email || '';
  }
  if (data) renderList();
}

async function changeUsage(input) {
  const key = input.dataset.used;
  if (hosted) {
    if (!cloudUser || !usageAvailable || cloudBusy) { syncUsage(); return; }
    const checked = input.checked;
    const userId = cloudUser.id;
    cloudBusy = true; syncUsage();
    try {
      const {error} = await cloud.from('question_usage').upsert({question_key:key, is_used:checked}, {onConflict:'question_key'});
      if (error) throw error;
      if (cloudUser?.id !== userId) return;
      if (checked) usedQuestions.add(key); else usedQuestions.delete(key);
      usageMessage = '';
    } catch {
      if (cloudUser?.id !== userId) return;
      usageMessage = '未能儲存到雲端，這次勾選未有生效。請檢查網絡後再試。';
    } finally {
      cloudBusy = false; syncUsage();
    }
    return;
  }
  try {
    // 每個分題獨立儲存，避免不同分頁的勾選互相覆蓋。
    if (input.checked) localStorage.setItem(usagePrefix + key, '1');
    else localStorage.removeItem(usagePrefix + key);
    if (input.checked) usedQuestions.add(key);
    else usedQuestions.delete(key);
    usageMessage = '';
  } catch {
    usageMessage = '未能儲存使用紀錄，這次勾選未有生效。請允許瀏覽器儲存資料後再試。';
  }
  syncUsage();
}

async function refreshCloudUsage() {
  if (!cloudUser || cloudBusy) return;
  const userId = cloudUser.id;
  cloudBusy = true; syncUsage();
  try {
    const records = [];
    for (let start = 0; ; start += 1000) {
      const {data:rows, error} = await cloud.from('question_usage').select('question_key,is_used').order('question_key').range(start,start+999);
      if (error) throw error;
      records.push(...rows);
      if (rows.length < 1000) break;
    }
    if (cloudUser?.id !== userId) return;
    const validKeys = new Set(data.questions.flatMap(usageKeys));
    usedQuestions = new Set(records.filter(row => row.is_used && validKeys.has(row.question_key)).map(row => row.question_key));
    usageAvailable = true; usageMessage = '';
  } catch {
    if (cloudUser?.id !== userId) return;
    usageAvailable = false;
    usageMessage = '未能讀取雲端紀錄。請檢查網絡，並在同步設定中重新讀取。';
  } finally {
    cloudBusy = false; syncUsage();
  }
}

function initCloudControls() {
  $('cloud-bar').hidden = false;
  syncUsage();
  if (!cloud) { $('cloud-send').disabled = true; return; }
  $('cloud-send').addEventListener('click',window.DSE_SIGNIN);
  $('cloud-refresh').addEventListener('click',refreshCloudUsage);
  $('cloud-logout').addEventListener('click',async () => {
    const {error} = await cloud.auth.signOut({scope:'local'});
    $('cloud-login-message').textContent = error ? '未能登出，請稍後再試。' : '已登出。';
  });
  window.addEventListener('focus',refreshCloudUsage);
  // ponytail: 可見頁面每 30 秒更新；需要即時顯示才改用 Realtime。
  setInterval(() => { if (!document.hidden) refreshCloudUsage(); },30000);
  refreshCloudUsage();
}

function loadManualDifficulties() {
  try {
    const saved = new Map();
    for (const q of data.questions.filter(q => q.kind === 'LQ')) {
      for (const d of q.details.filter(d => !d.difficulty?.level)) {
        const key = difficultyKey(q,d), level = localStorage.getItem(manualDifficultyPrefix + key);
        if (difficultyLevels.slice(0,3).includes(level)) saved.set(key,level);
      }
    }
    manualDifficulties = saved;
    difficultyAvailable = true;
    difficultyMessage = '';
  } catch {
    difficultyAvailable = false;
    difficultyMessage = '未能讀取自訂難度，暫時無法修改。請允許瀏覽器儲存資料後重新整理。';
  }
}

function refreshDifficulties() {
  const focused = document.activeElement;
  const key = focused.dataset.manualDifficulty;
  render(); writeURL();
  if (key) {
    const select = $(state.tab+'-panel')?.querySelector(`[data-manual-difficulty="${CSS.escape(key)}"]`);
    (select || $('detail-title') || $('search')).focus({preventScroll:true});
  }
}

function changeDifficulty(select) {
  const q = data.questions.find(q => q.id === select.dataset.difficultyQuestion);
  const d = q?.details.find(d => difficultyKey(q,d) === select.dataset.manualDifficulty);
  const level = select.value;
  if (q?.kind !== 'LQ' || !d || d.difficulty?.level || !['',...difficultyLevels.slice(0,3)].includes(level)) return;
  try {
    const key = difficultyKey(q,d);
    if (level) localStorage.setItem(manualDifficultyPrefix + key,level);
    else localStorage.removeItem(manualDifficultyPrefix + key);
    if (level) manualDifficulties.set(key,level);
    else manualDifficulties.delete(key);
    difficultyMessage = `${q.year} ${paperLabel(q)}第 ${q.label} 題 ${d.part}：${level ? '已儲存自訂難度「'+level+'」' : '已還原為資料不足'}。`;
  } catch {
    difficultyMessage = '未能儲存自訂難度，這次修改未有生效。請允許瀏覽器儲存資料後再試。';
  }
  refreshDifficulties();
}

function matchesSearch(q, query) {
  return normalize(query).replace(/\bpaper\s*([12])\b/g, 'paper$1').trim().split(/\s+/).filter(Boolean).every(token => {
    if (/^[23]\.[1-8]$/.test(token)) return q.paper === 2 && q.kind === 'MC' && q.label === token;
    const number = token.match(/^(?:q|第)?(\d{1,2})(?:題)?\*?$/);
    if (number) return q.number === Number(number[1]);
    if (/^20\d{2}$/.test(token)) return q.year === Number(token);
    return q.searchText.includes(token);
  });
}

function questionTopics(q, book) {
  return book ? q.filterTopicsByBook?.[book] || q.groupsByBook[book] || []
    : [...new Set(q.books.flatMap(book => questionTopics(q, book)))];
}

function difficultyParts(q, filters) {
  return q.details.filter(d => {
    const topics = filters.book ? d.filterTopicsByBook?.[filters.book] || [] : Object.values(d.filterTopicsByBook || {}).flat();
    if (!topics.length) return false;
    if (!filters.topic || topics.includes(filters.topic)) return true;
    // 舊網址的大分類仍可配對原分題名稱；正式細課題只用已核對的分題對應。
    if (canonicalTopics.has(filters.topic)) return false;
    const aliases = data.topicGroups[filters.topic] || [filters.topic];
    return [d.topic,d.classifiedTopic].flatMap(t => String(t || '').split(/\/|\s{2,}/)).some(t => aliases.includes(t.trim()));
  });
}

function questionDifficulties(q, filters) {
  const levels = difficultyParts(q, filters).map(d => difficultyLevel(q,d));
  if (!q.details.length) levels.push('資料不足');
  return difficultyLevels.filter(level => levels.includes(level));
}

function difficultySummaryHTML(q) {
  if (q.kind !== 'LQ') return '';
  const parts = difficultyParts(q, state);
  return `<div class="card-difficulties" id="difficulty-${q.id}"><span class="sr-only">${state.book || state.topic ? '相關' : '已收錄'}分題難度：</span>${questionDifficulties(q,state).map(level => {
    const matching = parts.filter(d => difficultyLevel(q,d) === level);
    const labels = matching.flatMap(usageParts);
    const manual = matching.some(d => !d.difficulty?.level && manualDifficulties.has(difficultyKey(q,d)));
    return `<span class="difficulty-label${state.difficulty===level?' is-selected':''}" data-difficulty="${level}" title="${esc(labels.length ? level+'：'+labels.join('、')+(manual?'（含自行設定）':'') : '未有分題分析，無法判定難度')}">${level}${manual?' · 自訂':''}</span>`;
  }).join('')}</div>`;
}

function selectQuestions(questions, filters) {
  const legacyTopic = !canonicalTopics.has(filters.topic);
  return questions.filter(q => (!filters.book || q.books.includes(filters.book)) &&
    (!filters.topic || questionTopics(q, filters.book).includes(filters.topic) ||
      (legacyTopic && (filters.book ? q.groupsByBook[filters.book] || [] : q.groups).includes(filters.topic))) && q.kind === filters.kind &&
    (!filters.year || q.year === Number(filters.year)) && matchesSearch(q, filters.search) &&
    (filters.kind !== 'LQ' || !filters.difficulty || questionDifficulties(q,filters).includes(filters.difficulty)));
}

function validSort(value) {
  const group = state.kind === 'LQ' ? 'difficulty' : 'rate';
  return ['oldest','newest',`${group}-asc`,`${group}-desc`].includes(value);
}

function compareQuestions(a, b) {
  if (state.sort.startsWith('difficulty-')) {
    const first = difficultyRank(a), second = difficultyRank(b);
    if (first !== second) return first === 3 ? 1 : second === 3 ? -1 : (first-second) * (state.sort === 'difficulty-asc' ? 1 : -1);
  }
  if (state.sort.startsWith('rate-')) {
    if (a.rate == null && b.rate != null) return 1;
    if (a.rate != null && b.rate == null) return -1;
    if (a.rate != null && b.rate != null && a.rate !== b.rate) return (a.rate - b.rate) * (state.sort === 'rate-asc' ? 1 : -1);
  }
  return (a.year - b.year) * (state.sort === 'oldest' || state.sort.startsWith('difficulty-') ? 1 : -1) || a.kind.localeCompare(b.kind) || a.number - b.number;
}

function difficultyRank(q) {
  // 多種難度只歸入一組；欠資料的分題不當作比「困難」更難。
  const known = questionDifficulties(q,state).filter(level => level !== '資料不足');
  return difficultyLevels.indexOf(known.at(-1) || '資料不足');
}

function questionGroup(q) {
  if (state.sort.startsWith('difficulty-')) return difficultyLevels[difficultyRank(q)];
  if (state.sort.startsWith('rate-')) return rateRanges[rateBand(q.rate)];
  return String(q.year);
}

function writeURL(push = false) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(state)) if (value && !(key === 'panel' && value === 'open') && !(key === 'sort' && value === defaults.sort) && !(key === 'tab' && value === 'scan')) params.set(key, value);
  history[push ? 'pushState' : 'replaceState'](null, '', '#' + params.toString());
}

function readURL() {
  if (difficultyAvailable) difficultyMessage = '';
  const params = new URLSearchParams(location.hash.slice(1));
  state = {...defaults};
  for (const key of Object.keys(defaults)) if (params.has(key)) state[key] = params.get(key);
  if (state.book && !Object.hasOwn(data.books,state.book)) state.book = '';
  if (!['MC','LQ'].includes(params.get('kind'))) state.kind = data.questions.find(q=>q.id===state.question)?.kind || searchKind(state.search) || 'MC';
  if (state.panel!=='closed') state.panel='open';
  if (!validSort(state.sort)) state.sort = defaults.sort;
  if (!['scan','analysis'].includes(state.tab)) state.tab = 'scan';
  if (state.year && !/^(201[2-9]|202[0-6])$/.test(state.year)) state.year = '';
  if (state.topic && !data.questions.some(q => questionTopics(q).includes(state.topic) || q.groups.includes(state.topic))) state.topic = '';
  if (state.kind !== 'LQ' || !difficultyLevels.includes(state.difficulty)) state.difficulty = '';
}

function renderTopics() {
  const base = selectQuestions(data.questions, {...state, book:'', topic:''});
  const bookButton = (book, name, count) => `<button class="book-button ${state.book === book && !state.topic ? 'active' : ''}" data-book="${book}" aria-pressed="${state.book === book && !state.topic}" ${topicOrder[book] ? `aria-expanded="${state.book === book && collapsedBook !== book}"` : ''}>${book ? `<span class="book-number">${book.padStart(2,'0')}</span>` : ''}<span>${name}</span><span class="count">${count}</span></button>`;
  let html = bookButton('', '全部課題', base.length);
  for (const [book, name] of Object.entries(data.books)) {
    const questions = selectQuestions(base, {...state,book,topic:''});
    html += bookButton(book, name, questions.length);
    if (state.book !== book || !topicOrder[book]) continue;
    const groups = [...new Set(data.questions.filter(q => q.books.includes(book)).flatMap(q => questionTopics(q, book)))];
    const order = [...topicOrder[book],'測量與誤差','原表未填課題','未細分（僅大課題分類）'];
    groups.sort((a,b) => (order.includes(a)?order.indexOf(a):order.length) - (order.includes(b)?order.indexOf(b):order.length));
    const topicButton = topic => `<button class="topic-button ${state.topic === topic ? 'active' : ''}" data-topic="${esc(topic)}" data-topic-book="${book}" aria-pressed="${state.topic === topic}"><span>${topic.startsWith('未細分') ? '僅大課題分類' : esc(topic)}</span><span class="count">${selectQuestions(questions,{...state,book,topic}).length}</span></button>`;
    const sections = Object.entries(data.topicSections[book] || {});
    const sectionTopics = sections.flatMap(([,topics]) => topics);
    html += `<div class="topic-group" ${collapsedBook === book ? 'hidden' : ''}>` + sections.map(([section,topics],index) => {
      const children = topics.filter(topic => groups.includes(topic));
      if (children.length === 1 && children[0] === section) return topicButton(section);
      const id = `topic-section-${book}-${index}`;
      return children.length ? `<div class="topic-section" role="group" aria-labelledby="${id}"><h3 class="topic-section-heading" id="${id}">${esc(section)}</h3><div class="topic-section-items">${children.map(topicButton).join('')}</div></div>` : '';
    }).join('') + groups.filter(topic => !sectionTopics.includes(topic)).map(topicButton).join('') + '</div>';
  }
  $('topics').innerHTML = html;
}

function questionCardHTML(q) {
  return `<button class="question-card" data-question="${q.id}" aria-current="${q.id === state.question}" ${q.kind==='LQ'?`aria-describedby="difficulty-${q.id}"`: ''} aria-label="${q.year} ${paperLabel(q)}${q.kind} 第 ${q.label} 題：${esc(q.scenario)}"><div class="card-reference"><strong>${q.year}</strong>${q.paper===2?`<span>Paper 2 · ${q.elective}</span>`:''}<span class="type-label ${q.kind.toLowerCase()}">${q.kind}</span><span>Q${q.label}</span></div><div class="card-title">${emphasizePhysics(q.scenario)}</div>${difficultySummaryHTML(q)}<div class="usage-summary${usageAvailable && usageKeys(q).some(key=>usedQuestions.has(key)) ? ' is-used' : ''}">${esc(usageSummary(q))}</div><div class="card-bottom"><span class="card-topic">${esc(q.incomplete ? q.books.map(book=>data.books[book]).join(' · ') : questionTopics(q).join(' · '))}</span>${q.incomplete ? '<span class="pending-label">僅分類</span>' : q.kind === 'MC' ? `<span class="rate-label">答對率 ${rateHTML(q.rate)}</span>` : `<span class="rate-label">${q.details.length} 列分析</span>`}</div></button>`;
}

function renderList() {
  $('result-label').textContent = `${state.kind} · ${state.topic || (state.book ? data.books[state.book] : '全部題目')}`;
  $('result-count').textContent = `${filtered.length} 題`;
  const detailed = filtered.filter(q => !q.incomplete).length;
  $('result-summary').textContent = `${detailed} 題有詳細分析 · ${filtered.length-detailed} 題僅分類${state.sort.startsWith('rate-') ? '；未提供答對率的題目排最後。' : ''}${state.sort.startsWith('difficulty-') ? '；混合難度按相關分題最高已知難度歸組。' : state.kind==='LQ' ? '；難度標籤按目前課題的分題顯示。' : ''}`;
  const groups = new Map();
  for (const q of filtered) {
    const label = questionGroup(q);
    if (!groups.has(label)) groups.set(label,[]);
    groups.get(label).push(q);
  }
  $('question-list').innerHTML = filtered.length ? [...groups].map(([label, questions], index) => `<section class="question-group" aria-labelledby="question-group-${index}"><h2 class="question-group-heading" id="question-group-${index}">${esc(label)}</h2>${questions.map(questionCardHTML).join('')}</section>`).join('') : '<div class="empty"><strong>沒有符合的題目</strong><p>試試其他關鍵字或年份。<br>可按必修課題或 E2／E3 選修單元篩選。</p><button data-reset>重設篩選</button></div>';
}

function renderFilters() {
  const labels = {book:data.books[state.book],topic:state.topic,year:state.year,difficulty:`難度：${state.difficulty}`,search:`搜尋：${state.search}`};
  const entries = Object.entries(labels).filter(([key]) => state[key]);
  $('active-filters').hidden = !entries.length;
  $('active-filters').innerHTML = '<span>目前條件</span>' + entries.map(([key,label]) => `<button class="filter-chip" data-remove="${key}" aria-label="移除${esc(label)}篩選">${esc(label)} <span aria-hidden="true">×</span></button>`).join('');
}

function sourceNote(source) {
  if (/\/report\//i.test(source.href)) return '';
  const location = source.page ? `PDF 第 ${esc(source.page)} 頁` : `${esc(source.sheet)} · 第 ${source.row} 列`;
  return `<div class="source-note">來源：<a href="${esc(source.href)}" target="_blank" rel="noopener">${esc(source.file)}</a><br>${location}</div>`;
}

function fieldsHTML(fields) {
  return Object.entries(fields).filter(([label,value]) => !(label.includes('來源') && /HKDSE_phy_|報告會|簡報/.test(value))).map(([label,value]) => `<p><strong>${esc(label)}</strong><br>${value == null || value === '' ? '未提供' : /答對率/.test(label) && typeof value === 'number' ? rateHTML(value) : esc(value)}</p>`).join('');
}

function topicHue(topic) {
  const colors = {'溫度、熱和內能':210, '熱轉移過程':28, '電磁波譜中的光':275};
  // 按分類名稱固定配色，切換年份、排序或加入題目均不會改色。
  let hash = 0;
  for (const char of topic.normalize('NFKC')) hash = (Math.imul(hash,31) + char.codePointAt(0)) >>> 0;
  return Object.hasOwn(colors,topic) ? colors[topic] : hash % 36000 / 100;
}

function topicLabelsHTML(values) {
  const labels = [...new Set(values.flatMap(value => String(value ?? '').split('/')).map(label => label.trim()).filter(Boolean))];
  return labels.length ? `<span class="topic-labels">${labels.map(label => `<span class="topic-label" data-topic-label="${esc(label)}" style="--topic-hue:${topicHue(label)}">${esc(label)}</span>`).join(' ')}</span>` : '原表未填課題';
}

function difficultyHTML(q, d) {
  const value = d.difficulty;
  const level = difficultyLevel(q,d);
  const manual = !value?.level && level !== '資料不足';
  const editor = value?.level ? '' : `<div class="manual-difficulty"><label>自行設定難度 <select data-manual-difficulty="${esc(difficultyKey(q,d))}" data-difficulty-question="${esc(q.id)}" aria-label="${esc(`${q.year} ${paperLabel(q)}第 ${q.label} 題 ${d.part} 自行設定難度`)}" ${difficultyAvailable?'':'disabled'}>${['',...difficultyLevels.slice(0,3)].map(option => `<option value="${option}" ${option===(manual?level:'')?'selected':''}>${option || '未設定（資料不足）'}</option>`).join('')}</select></label><small>儲存在此瀏覽器，供難度篩選及排序使用；選「未設定」可還原。</small></div>`;
  return `<details class="difficulty-evidence"><summary><span class="difficulty-label" data-difficulty="${esc(level)}">${esc(level)}</span>${manual?'<span class="manual-difficulty-label">自行設定</span>':''}<span>考生表現與依據</span></summary>${manual?'<p>目前難度由用家自行設定；以下保留原有資料不足的原因。</p>':''}${value?.scope ? `<p>${esc(value.scope)}</p>` : ''}<p>${esc(value?.reason || '未有考生表現資料。')}</p>${value?.source ? sourceNote(value.source) : ''}${value?.reviewSource ? sourceNote(value.reviewSource) : ''}${value?.supplement ? `<p>${esc(value.supplement.note)}</p>${sourceNote(value.supplement.source)}` : ''}</details>${editor}`;
}

function difficultyMethodHTML() {
  return `<details class="difficulty-method"><summary>難度分類方法（依考生表現推定）</summary>${(data.difficultyMethod || []).filter(line=>!/報告會|簡報|投影片/.test(line)).map(line=>`<p>${esc(line)}</p>`).join('')}</details>`;
}

function partHeadingHTML(q, d) {
  const parts = usageParts(d);
  return `<div class="part-title"><span class="part-number">${esc(d.part)}</span><div class="part-tools"><span class="marks">${esc(d.marks ?? '未提供')} 分</span><div class="part-usage">${parts.map(part=>usageCheckboxHTML(q,part,parts.length>1)).join('')}</div></div><h3>${topicLabelsHTML([d.topic,d.classifiedTopic])}</h3></div>`;
}

function analysisHTML(q) {
  let html = q.incomplete ? '<div class="notice">已完成大課題分類。本次未加入細分課題、答案、答對率或考核概念。</div>' : '';
  if (q.kind === 'LQ') html += difficultyMethodHTML();
  if (q.analysisNote) html += `<div class="notice">${esc(q.analysisNote)}</div>`;
  if (q.classificationNote) html += `<article class="analysis-card"><h3>大課題分類：${q.books.map(book=>esc(data.books[book])).join('、')}</h3><p>${esc(q.classificationNote)}</p><a href="${esc(q.images[0].href)}" target="_blank" rel="noopener">查看分類依據：原卷第 ${q.images[0].page} 頁 ↗</a></article>`;
  if (q.syllabusSource) html += `<article class="analysis-card"><h3>官方課程分類</h3><p>${q.lqClassification ? '按分題列出課程小標題，見下方分類。' : `${esc(q.section)} · ${topicLabelsHTML(q.topics)}`}</p>${sourceNote(q.syllabusSource)}</article>`;
  if (q.kind === 'LQ' && !q.lqClassification) html += '<p class="source-note" style="border:0;margin:0 0 18px;padding:0">以下為原表已分析的分題；其他分題仍可在原題截圖查看。</p>';
  html += q.details.map(d => q.kind === 'LQ' ? `<article class="analysis-card">${partHeadingHTML(q,d)}<dl><dt>考核重點／概念</dt><dd>${emphasizePhysics(d.concept || '未提供')}</dd><dt>題目重點</dt><dd>${emphasizePhysics(d.description)}</dd></dl>${difficultyHTML(q,d)}<details class="raw-source"><summary>${d.classified ? '查看分類欄位' : '查看原表完整欄位'}</summary><div class="raw-fields">${fieldsHTML(d.fields)}</div></details>${sourceNote(d.source)}${d.classificationSource ? sourceNote(d.classificationSource) : ''}</article>` : `<article class="analysis-card"><h3>MC 題目分析</h3><dl>${Object.entries(d.fields).filter(([label]) => !['年份','題號','答對率來源'].includes(label)).map(([label,value])=>`<dt>${esc(label)}</dt><dd>${value == null ? '未提供' : /答對率/.test(label) && typeof value === 'number' ? rateHTML(value) : /^(課題類別|細分課題|考核課題)$/.test(label) ? topicLabelsHTML([value]) : esc(value)}</dd>`).join('')}</dl>${sourceNote(d.source)}${d.rateSource ? sourceNote(d.rateSource) : ''}</article>`).join('');
  html += (q.yearlyDetails || []).map(d => `<article class="analysis-card"><h3>逐年分析表</h3><div class="raw-fields">${fieldsHTML(d.fields)}</div>${sourceNote(d.source)}</article>`).join('');
  return html;
}

function keyAnalysisHTML(q) {
  const marks = q.details.reduce((sum,d) => sum + (Number(d.marks) || 0),0);
  const facts = q.kind==='MC' ? [[q.syllabusAnalysis?'官方答案':'原表答案',q.answer],['答對率',q.rate==null?null:percent(q.rate)]] : [['已分析分值',`${marks} 分`],['已分析分題',`${q.details.length} 列`]];
  const points = q.kind==='LQ'
    ? `<ol class="key-points">${q.details.map(d=>`<li>${partHeadingHTML(q,d)}<p>${emphasizePhysics(d.concept || d.description || '原表未填考點')}</p>${difficultyHTML(q,d)}</li>`).join('')}</ol>`
    : `<p class="key-concept">${emphasizePhysics(q.concept || q.scenario)}</p>${q.concept && q.scenario!==q.concept ? `<p class="key-context">${emphasizePhysics(q.scenario)}</p>` : ''}`;
  return `<aside class="key-analysis" aria-label="分析重點">
    <div class="key-heading"><h3>${q.incomplete?'課題資料':'分析重點'}</h3><span class="data-status ${q.incomplete?'basic':'detailed'}">${q.incomplete?'僅分類':q.status==='deleted'?'試題被刪去':q.syllabusAnalysis?'課程分析':'原表分析'}</span></div>
    <div class="badges">${q.books.map(book=>`<span class="badge">${book.startsWith('E')?book:'Book '+book} · ${esc(data.books[book])}</span>`).join('')}${q.incomplete?'':topicLabelsHTML(q.topics)}</div>
    ${q.incomplete ? '<div class="notice">此題尚未加入詳細分析；答案及答對率未提供。</div>' : `<dl class="facts">${facts.map(([label,value])=>`<div class="fact"><dt>${label}</dt><dd ${value==null?'class="missing"':''}>${label==='答對率' ? rateHTML(q.rate) : esc(value ?? '未提供')}</dd></div>`).join('')}</dl>${q.kind==='LQ'?difficultyMethodHTML():''}${points}<p class="data-note">${q.kind==='LQ'?'已分析分值只計算已收錄分題，不代表整題總分。':esc(q.analysisNote || '答案及答對率沿用原分析表。')}</p>`}
    <button class="next-action" data-tab="analysis">完整分析與來源 <span aria-hidden="true">→</span></button>
  </aside>`;
}

function renderDetail() {
  const q = filtered.find(q => q.id === state.question);
  const difficultyNotice = `<p id="difficulty-message" class="usage-note" role="status" ${difficultyMessage?'':'hidden'}>${esc(difficultyMessage)}</p>`;
  if (!q) { $('detail').innerHTML = difficultyNotice + '<div class="empty"><strong>未有可顯示的題目</strong><p>移除上方的篩選條件，或清除篩選重新找題。</p></div>'; document.title='物理題目索引 · HKDSE'; return; }
  const showingAnswer = answerQuestion === q.id;
  const index = filtered.indexOf(q);
  const images = showingAnswer ? q.answerImages : q.images;
  const contentLabel = showingAnswer ? '參考答案' : '原題';
  $('detail').innerHTML = `
    <div class="detail-heading">
      <h2 class="detail-title" id="detail-title" tabindex="-1">${q.year} · ${paperLabel(q)}${q.kind} 第 ${q.label} 題</h2>
      <div class="reader-actions">
        ${q.kind==='MC' ? usageCheckboxHTML(q) : ''}
        <div class="question-nav"><span class="question-position">${index+1} / ${filtered.length}</span><button class="icon-button" data-step="-1" aria-label="上一題" ${index===0?'disabled':''}>‹<span> 上一題</span></button><button class="icon-button" data-step="1" aria-label="下一題" ${index===filtered.length-1?'disabled':''}><span>下一題 </span>›</button></div>
        <button class="expand-button answer-toggle" data-answer-toggle aria-pressed="${showingAnswer}" aria-controls="scan-panel">${showingAnswer?'顯示題目':'顯示答案'}</button>
        <a class="primary-link" href="${esc(q.images[0].href)}" target="_blank" rel="noopener">原卷 ↗</a>${images.length?`<button class="expand-button" data-expand>⤢ 放大${contentLabel}</button>`:''}
      </div>
    </div>
    <p id="usage-message" class="usage-note" role="status">${esc(usageNote())}</p>
    ${difficultyNotice}
    <div class="tab-bar"><div role="tablist" aria-label="題目內容"><button id="scan-tab" role="tab" aria-controls="scan-panel" data-tab="scan" aria-selected="${state.tab==='scan'}" tabindex="${state.tab==='scan'?0:-1}">原題與重點</button><button id="analysis-tab" role="tab" aria-controls="analysis-panel" data-tab="analysis" aria-selected="${state.tab==='analysis'}" tabindex="${state.tab==='analysis'?0:-1}">完整分析與來源</button></div></div>
    <div id="scan-panel" role="tabpanel" aria-labelledby="scan-tab" tabindex="0" ${state.tab!=='scan'?'hidden':''}>
      <div class="reading-layout"><div class="question-paper">
      ${showingAnswer?`<h3 class="answer-heading">參考答案</h3>${q.kind==='MC'?`<div class="mc-model-answer">${q.answer?`<p>正確選項</p><strong>${esc(q.answer)}</strong>`:`<p>${q.status==='deleted'?'本試題已被官方刪去，不設答案。':'現有評卷參考未提供此題答案。'}</p>`}</div>`:''}`:''}
      ${images.map((im,i)=>`<figure class="scan"><button data-expand aria-label="放大 ${q.year} ${paperLabel(q)}${q.kind} 第 ${q.label} 題${contentLabel}第 ${i+1} 張截圖"><img ${imageSource(im)} width="${im.width}" height="${im.height}" ${i?'loading="lazy"':''} alt="${q.year} 年 ${paperLabel(q)}${q.kind} 第 ${q.label} 題${contentLabel}截圖，PDF 第 ${im.page} 頁"></button><figcaption><span>${i+1} / ${images.length} · ${showingAnswer?'評卷參考':'原卷'} PDF 第 ${im.page} 頁</span><div class="scan-actions"><button class="copy-image" data-copy-image aria-label="複製第 ${i+1} 張${contentLabel}圖片">複製圖片</button><a href="${esc(im.href)}" target="_blank" rel="noopener">開啟此頁 ↗</a></div><span class="copy-status" role="status"></span></figcaption></figure>`).join('')}
      </div>${keyAnalysisHTML(q)}</div>
    </div>
    <div id="analysis-panel" role="tabpanel" aria-labelledby="analysis-tab" tabindex="0" ${state.tab!=='analysis'?'hidden':''}>${analysisHTML(q)}<p class="source-help">原卷及分析來源連結需要原有的「PHYS DSE」、「report」及「tutor」資料夾。${q.syllabusAnalysis?'分類採用中文修訂課程的正式小標題；缺少的官方資料留空。':'分析內容沿用收錄原表，未重新核對評卷參考。'}</p></div>`;
  document.title = `${q.year} ${paperLabel(q)}${q.kind} Q${q.label} · 物理題目索引`;
  if (hosted) $('detail').querySelectorAll('a[href^="../"]').forEach(link => {
    const label = document.createElement('span');
    label.textContent = link.textContent.replace(' ↗','') + '（本機來源）';
    label.title = '原卷及來源文件可在本機版開啟；網頁版保留題目及答案截圖。';
    link.replaceWith(label);
  });
  if (hosted) loadPrivateImages($('detail'));
}

const imageSource = im => hosted ? `data-private-src="${esc(im.src)}"` : `src="${esc(im.src)}"`;
function loadPrivateImages(root) {
  root.querySelectorAll('img[data-private-src]').forEach(async image => {
    try {
      const url = await window.DSE_IMAGE_URL(image.dataset.privateSrc);
      if (image.isConnected) image.src = url;
    } catch {
      if (image.isConnected) image.alt += '（圖片未能載入，請檢查網絡後重新整理。）';
    }
  });
}

function renderPanels() {
  const open=state.panel==='open';
  document.body.classList.toggle('list-hidden',!open);
  $('question-results').inert=!open;
  const toggle=$('list-toggle');
  toggle.setAttribute('aria-expanded',String(open));
  toggle.title=`${open?'收起':'展開'}題目清單`;
  toggle.setAttribute('aria-label',toggle.title);
}

function render() {
  filtered = selectQuestions(data.questions, state).sort(compareQuestions);
  if (!filtered.some(q => q.id === state.question)) state.question = filtered[0]?.id || '';
  renderPanels();
  $('search').value = state.search;
  $('year').value = state.year;
  $('sort').value = state.sort;
  document.querySelectorAll('#sort option').forEach(option => { option.hidden = option.disabled = !validSort(option.value); });
  $('difficulty-filter').hidden = state.kind !== 'LQ';
  $('difficulty').value = state.difficulty;
  document.querySelectorAll('[data-kind]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.kind === state.kind)));
  renderTopics(); renderFilters(); renderList(); renderDetail();
}

async function setListOpen(open) {
  state.panel=open?'open':'closed';
  renderPanels(); writeURL();
  const toggle=$('list-toggle');
  if (!open) toggle.focus({preventScroll:true});
  else {
    await Promise.all($('question-results').getAnimations().map(a=>a.finished.catch(()=>{})));
    if (state.panel!=='open' || document.activeElement!==toggle) return;
    const selected=document.querySelector(`[data-question="${state.question}"]`);
    selected?.scrollIntoView({block:'nearest'});
    selected?.focus({preventScroll:true});
  }
}

function updateFilters(changes) {
  answerQuestion = '';
  if (difficultyAvailable) difficultyMessage = '';
  const focused = document.activeElement;
  const fromTopics = $('sidebar').contains(focused);
  Object.assign(state,changes,{tab:'scan'});
  if (state.kind !== 'LQ') state.difficulty = '';
  if (!validSort(state.sort)) state.sort = defaults.sort;
  render(); writeURL(); $('question-list').scrollTop=0; $('reader').scrollTop=0;
  if (fromTopics) {
    const selector = 'topic' in focused.dataset ? `[data-topic="${CSS.escape(focused.dataset.topic)}"][data-topic-book="${focused.dataset.topicBook}"]` : `[data-book="${focused.dataset.book}"]`;
    document.querySelector(selector)?.focus({preventScroll:true});
  } else if (!focused.isConnected) $('search').focus({preventScroll:true});
}

function chooseQuestion(id) {
  if (!filtered.some(q => q.id === id)) return;
  answerQuestion = '';
  if (difficultyAvailable) difficultyMessage = '';
  state.question=id; state.tab='scan';
  renderList(); renderDetail(); writeURL(true);
  $('reader').scrollTop=0;
  $('detail-title').focus({preventScroll:true});
  if(state.panel==='open') document.querySelector(`[data-question="${id}"]`)?.scrollIntoView({block:'nearest'});
}

async function imagePNG(image) {
  if (hosted) {
    const copy = new Image();
    copy.src = await window.DSE_IMAGE_URL(image.dataset.privateSrc);
    await copy.decode();
    const canvas = document.createElement('canvas');
    canvas.width = copy.naturalWidth; canvas.height = copy.naturalHeight;
    canvas.getContext('2d').drawImage(copy,0,0);
    return new Promise((resolve,reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('圖片轉換失敗')),'image/png'));
  }
  const src=image.getAttribute('src');
  const name=src.split('/').pop();
  if (!window.DSE_COPY_IMAGES[name]) {
    await new Promise((resolve,reject)=>{
      const script=document.createElement('script');
      script.src=src+'.js';
      script.onload=()=>{script.remove();resolve();};
      script.onerror=()=>{script.remove();reject(new Error('圖片資料未能載入'));};
      document.head.append(script);
    });
  }
  const copy=new Image();
  copy.src=window.DSE_COPY_IMAGES[name] || '';
  await copy.decode();
  const canvas=document.createElement('canvas');
  canvas.width=copy.naturalWidth; canvas.height=copy.naturalHeight;
  canvas.getContext('2d').drawImage(copy,0,0);
  return new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('圖片轉換失敗')),'image/png'));
}

async function copyImage(button) {
  const scan=button.closest('.scan');
  const status=scan.querySelector('.copy-status');
  button.disabled=true; status.textContent='正在複製…';
  try {
    if (!navigator.clipboard?.write || !window.ClipboardItem) throw new Error('瀏覽器不支援圖片複製');
    await navigator.clipboard.write([new ClipboardItem({'image/png':imagePNG(scan.querySelector('img'))})]);
    status.textContent='已複製圖片，可以貼上。';
  } catch (error) {
    status.textContent=error.name==='NotAllowedError'
      ? '瀏覽器未允許複製。請允許剪貼簿權限，或在圖片上按右鍵選「複製圖片」。'
      : '未能複製圖片。請重試，或在圖片上按右鍵選「複製圖片」。';
  } finally {button.disabled=false;}
}

function openImages() {
  const q = filtered.find(q => q.id===state.question);
  if (!q) return;
  const showingAnswer = answerQuestion === q.id;
  const images = showingAnswer ? q.answerImages : q.images;
  if (!images.length) return;
  $('image-title').textContent=`${q.year} ${paperLabel(q)}${q.kind} 第 ${q.label} 題 · ${showingAnswer?'參考答案 · ':''}${images.length} 張截圖`;
  $('zoom-images').innerHTML=images.map(im=>`<img ${imageSource(im)} width="${im.width}" height="${im.height}" alt="${q.year} ${paperLabel(q)}${q.kind} 第 ${q.label} 題${showingAnswer?'參考答案':''}，PDF 第 ${im.page} 頁">`).join('');
  $('zoom').value='100'; $('zoom-images').style.width='100%';
  if (hosted) loadPrivateImages($('zoom-images'));
  $('image-dialog').showModal(); $('zoom-scroll').scrollTop=0;
}

function switchTab(tab) {
  state.tab=tab; renderDetail(); writeURL();
  $(tab+'-tab').focus({preventScroll:true});
  $('reader').scrollTop=0;
}

async function init() {
  if (!await window.DSE_READY) return;
  data = window.DSE_DATA;
  topicOrder = data?.topicOrder || {};
  canonicalTopics = new Set(Object.values(topicOrder).flat());
  if (!data?.questions?.length) { $('detail').innerHTML='<div class="empty"><strong>題庫資料未能載入</strong><p>請確認 data.js 與 index.html 放在同一資料夾，再重新開啟。</p></div>'; return; }
  if (hosted) {
    usageAvailable = false;
    usageMessage = '登入後可讀取及勾選已使用紀錄。';
    cloudUser = window.DSE_USER;
  } else { loadUsage(); }
  loadManualDifficulties();
  for (const q of data.questions) {
    q.searchText=normalize([q.year, q.kind, q.paper===2?`paper2 卷二 選修 ${q.elective} ${q.kind==='MC'?'選擇題':'長題 短答 結構式題目'}`:q.kind==='MC'?'paper1 選擇題 卷一甲 1a ia':'paper1 長題 長問題 卷一乙 1b ib', q.scenario,q.concept,q.format,...q.topics,...q.groups,...questionTopics(q),...q.books.map(book=>`book ${book} ${data.books[book]}`),...q.details.map(d=>Object.values(d.fields).join(' '))].join(' '));
  }
  for (let year=2012;year<=2026;year++) $('year').add(new Option(year,year));
  $('library-count').innerHTML=`<span>${data.questions.length}<small> 道原題</small></span><small>${data.questions.filter(q=>q.kind==='MC').length} 道 MC · ${data.questions.filter(q=>q.kind==='LQ').length} 道長題</small>`;
  $('coverage-content').innerHTML=`<div class="coverage-totals">${data.questions.length} 題 / ${data.questions.reduce((sum,q)=>sum+q.images.length,0)} 張原題截圖</div><p>2012–2026 必修 501 道 MC、E2／E3 選修 240 道 MC，以及 ${data.questions.filter(q=>q.kind==='LQ').length} 道長題。共 ${data.questions.filter(q=>q.kind==='LQ').reduce((n,q)=>n+q.details.length,0)} 列長題分題分析及 ${data.questions.filter(q=>q.kind==='MC').reduce((n,q)=>n+q.details.length,0)} 列 MC 詳細分析。</p><table class="coverage-table"><thead><tr><th>課本／單元</th><th>題型</th><th>年份</th><th>分析範圍</th></tr></thead><tbody>${data.coverage.map(c=>`<tr><td>${c.book}</td><td>${c.kind}</td><td>${c.years}</td><td>${c.note}</td></tr>`).join('')}</tbody></table><p>2012 年力學 MC 第 5–14 題已補上課程分類、考法及關鍵概念，10 個答案及答對率均按官方評卷參考第 1 頁核對。其餘原未分析的 53 題 MC 已補概念分類，並補回 2013–2016 共 40 個官方答案及答對率；2018 Q1 官方刪題。<a href="unanalyzed.html">未分析題號</a> 分成 MC、長題兩表，列齊缺資料的題號、分題及覆核原因。</p><p>Book 3、4、5 共 313 道 MC 已補上官方課程細項、考法及精簡概念，並核對 291 個官方答案、277 個官方答對率。2016 Q29 被官方刪去，保留原題及註記；必修 2025 部分題目缺答對率、2026 缺官方答案及答對率，相關欄位留空。</p><p>波動、電與磁、放射現象及核能的長題涵蓋 2012–2026 年，按原卷的分題編號、星號及配分分類；已加入分類、概念及評卷參考答案；按「顯示答案」切換查看。跨課題分題在相應課本下可找到，已存在原表的同一分題只計分一次。全題截圖保留，原卷合併配分的分題不另行拆分分值。</p><p>Book 1、2 的原有 159 列長題分析、125 列 MC 分析及 2024–2026 逐年表的 99 列欄位保留。力學長題原表實際只有 2018–2024 年資料；2026 的新長題分類由原卷整理。舊表的大分類如與原題不同，分類說明會列出修正。</p><p>五個課本均按中文修訂課程第 1–15 頁顯示分項標題及細課題。Book 1、2 的已分析題目按原有考點對應細課題，長題以已收錄分題的考點供篩選；原表答案、答對率、分值及考點沿用原資料，未重新核對評卷參考。</p><p>Paper 2 只收錄 E2「原子世界」及 E3「能量和能源的使用」，涵蓋 2012–2026 年；每年每單元有 8 道 MC 及一道 10 分結構式題目。共 240 道 MC、30 道結構式題目、167 列分題分析。MC 已核對 239 個答案及 239 個答對率；2017 E3 第 3.7 題被官方刪去，2025 全部 16 個答對率已補齊。分類採用中文修訂課程第 18–23 頁，跨課題分題可由多個標籤找到。</p><p>全部截圖已存於本機。原卷及 Excel 連結指向旁邊的「PHYS DSE」資料夾；若只搬移網站資料夾，搜尋、分析及截圖仍可使用。</p>`;
  const difficultyCounts = data.questions.filter(q=>q.kind==='LQ').flatMap(q=>q.details).reduce((counts,d)=>{const level=d.difficulty?.level || '資料不足'; counts[level]=(counts[level] || 0)+1; return counts;},{});
  $('coverage-content').insertAdjacentHTML('beforeend',`<p>長／短答難度（按考評資料評級，未計用家自行設定）：${['容易','中等','困難','資料不足'].map(level=>`${level} ${difficultyCounts[level] || 0} 列`).join('、')}。</p>${difficultyMethodHTML()}`);
  readURL(); render(); writeURL();
  if (hosted) initCloudControls();
  document.querySelector(`[data-question="${state.question}"]`)?.scrollIntoView({block:'nearest'});
  $('search').addEventListener('input',event=>updateFilters({search:event.target.value,kind:searchKind(event.target.value) || state.kind}));
  $('year').addEventListener('change',event=>updateFilters({year:event.target.value}));
  $('difficulty').addEventListener('change',event=>updateFilters({difficulty:event.target.value}));
  $('sort').addEventListener('change',event=>updateFilters({sort:event.target.value}));
  $('zoom').addEventListener('change',event=>{$('zoom-images').style.width=event.target.value+'%';});
  document.addEventListener('change',event=>{
    if (event.target.matches('input[data-used]')) changeUsage(event.target);
    if (event.target.matches('select[data-manual-difficulty]')) changeDifficulty(event.target);
  });
  window.addEventListener('storage',event=>{
    if (!hosted && (event.key === null || event.key.startsWith(usagePrefix))) { loadUsage(); syncUsage(); }
    if (event.key === null || event.key.startsWith(manualDifficultyPrefix)) { loadManualDifficulties(); refreshDifficulties(); }
  });
  document.addEventListener('click',event=>{
    if (event.target.closest('.skip')) {event.preventDefault();$('search').focus();return;}
    const button=event.target.closest('button'); if (!button) return;
    const d=button.dataset;
    if ('question' in d) chooseQuestion(d.question);
    else if ('book' in d) {
      if (d.book === state.book && topicOrder[d.book]) {
        collapsedBook = collapsedBook === d.book ? '' : d.book;
        button.setAttribute('aria-expanded',String(collapsedBook !== d.book));
        button.nextElementSibling.hidden = collapsedBook === d.book;
      } else {
        collapsedBook = '';
        updateFilters({book:d.book,topic:''});
      }
    }
    else if ('topic' in d) updateFilters({book:d.topicBook,topic:state.topic===d.topic && state.book===d.topicBook?'':d.topic});
    else if ('kind' in d) updateFilters({kind:d.kind});
    else if ('remove' in d) updateFilters(d.remove==='book'?{book:'',topic:''}:{[d.remove]:''});
    else if ('tab' in d) switchTab(d.tab);
    else if ('answerToggle' in d) {
      answerQuestion = answerQuestion === state.question ? '' : state.question;
      state.tab = 'scan';
      renderDetail(); writeURL();
      document.querySelector('[data-answer-toggle]').focus({preventScroll:true});
    }
    else if ('expand' in d) openImages();
    else if ('copyImage' in d) copyImage(button);
    else if ('step' in d) chooseQuestion(filtered[filtered.findIndex(q=>q.id===state.question)+Number(d.step)]?.id);
    else if ('close' in d) $(d.close).close();
    else if ('reset' in d || button.id==='reset') updateFilters({...defaults,kind:state.kind,panel:state.panel});
    else if (button.id==='coverage-button') $('coverage-dialog').showModal();
    else if (button.id==='cloud-button') $('cloud-dialog').showModal();
    else if (button.id==='list-toggle') setListOpen(state.panel!=='open');
  });
  document.addEventListener('keydown',event=>{
    if (event.key==='/' && !['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName) && !document.querySelector('dialog[open]')) {event.preventDefault();$('search').focus();}
    if (event.target.matches('[role=tab]') && ['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) {event.preventDefault();switchTab(event.key==='Home'?'scan':event.key==='End'?'analysis':state.tab==='scan'?'analysis':'scan');}
  });
  window.addEventListener('popstate',()=>{
    answerQuestion = '';
    readURL(); render(); writeURL(); $('reader').scrollTop=0;
    const selected=document.querySelector(`[data-question="${state.question}"]`);
    selected?.scrollIntoView({block:'nearest'});
    ($('detail-title') || $('search')).focus({preventScroll:true});
  });
}
init();
