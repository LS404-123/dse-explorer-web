// 網頁版只從私人 Storage 下載內容；本機版沿用 data.js。
'use strict';
window.DSE_READY = (async () => {
  const $ = id => document.getElementById(id);
  if (location.protocol === 'file:') {
    await new Promise((resolve,reject) => {
      const script = document.createElement('script');
      script.src = 'data.js'; script.onload = resolve; script.onerror = reject;
      document.head.append(script);
    });
    $('private-gate').hidden = true;
    document.querySelector('.workspace').hidden = false;
    document.querySelector('.skip').hidden = false;
    return true;
  }
  document.querySelector('.header-right').hidden = true;
  document.querySelector('.skip').hidden = true;
  const client = window.supabase?.createClient(
    'https://gxwddhfwwnbofhsxqadl.supabase.co',
    'sb_publishable_LpAGDhmj7Cen_EaQK-QUVw_3--j7ETU'
  );
  window.DSE_CLOUD = client;
  const message = $('private-status');
  window.DSE_SIGNIN = async () => {
    $('private-login').disabled = true;
    message.textContent = '正在前往 GitHub 登入…';
    try {
      const {error} = await client.auth.signInWithOAuth({provider:'github',options:{redirectTo:location.origin+location.pathname}});
      if (error) throw error;
    } catch {
      message.textContent = '未能開啟 GitHub 登入，請稍後再試。';
      $('private-login').disabled = false;
    }
  };
  $('private-login').addEventListener('click',window.DSE_SIGNIN);
  $('private-retry').addEventListener('click',() => location.reload());
  const logout = async () => {
    const {error} = await client.auth.signOut({scope:'local'});
    if (error) message.textContent = '未能登出，請稍後再試。';
  };
  $('private-logout').addEventListener('click',logout);
  if (!client) { message.textContent = '登入功能未能載入，請重新整理。'; return false; }
  try {
    // 先讓 SDK 處理 OAuth hash，再讀取題目網址，避免清掉登入 token。
    const showMissing = new URLSearchParams(location.hash.slice(1)).get('view') === 'unanalyzed';
    const {data:sessionData,error} = await client.auth.getSession();
    if (error) throw error;
    const user = sessionData.session?.user;
    const userId = user?.id;
    client.auth.onAuthStateChange((event,session) => {
      if ((session?.user?.id || null) !== (userId || null)) {
        document.querySelector('.workspace').hidden = true;
        document.querySelector('.header-right').hidden = true;
        $('private-document').replaceChildren();
        window.DSE_DATA = null;
        location.reload();
      }
    });
    if (!user) {
      message.textContent = '請使用獲授權的 GitHub 帳戶登入。';
      $('private-login').disabled = false;
      return false;
    }
    $('private-logout').hidden = false;
    const bucket = client.storage.from('dse-private');
    const read = async path => {
      const {data,error} = await bucket.download(path);
      if (error) throw error;
      return data;
    };
    if (showMissing) {
      const source = new DOMParser().parseFromString(await (await read('unanalyzed.html')).text(),'text/html');
      source.querySelectorAll('a[href^="../"]').forEach(link => link.replaceWith(document.createTextNode(link.textContent+'（本機來源）')));
      for (const style of source.querySelectorAll('style')) document.head.append(document.importNode(style,true));
      $('private-document').append($('private-logout'),document.importNode(source.querySelector('main'),true));
      $('private-document').hidden = false;
      $('private-gate').hidden = true;
      document.title = '未分析題號 · HKDSE 物理';
      return false;
    }
    const catalogue = JSON.parse(await (await read('catalogue.json')).text());
    if (!Array.isArray(catalogue.questions) || !catalogue.questions.length) throw new Error('題庫資料格式不正確');
    window.DSE_DATA = catalogue;
    window.DSE_USER = user;
    const images = new Map();
    // ponytail: 本次登入期間保留看過的圖片；若記憶體使用偏高才加入快取上限。
    window.DSE_IMAGE_URL = path => {
      if (!/^(questions|answers)\/[^/]+\.(png|webp)$/.test(path) || path.includes('..')) return Promise.reject(new Error('圖片路徑不正確'));
      if (!images.has(path)) images.set(path,read(path).then(blob => URL.createObjectURL(blob)).catch(error => { images.delete(path); throw error; }));
      return images.get(path);
    };
    $('private-gate').hidden = true;
    document.querySelector('.workspace').hidden = false;
    document.querySelector('.skip').hidden = false;
    document.querySelector('.header-right').hidden = false;
    document.querySelector('.offline').textContent = '私人題庫';
    $('private-logout').hidden = true;
    return true;
  } catch {
    message.textContent = '未能開啟私人題庫。請確認使用獲授權的 GitHub 帳戶，或檢查網絡後重試。';
    $('private-login').disabled = false;
    $('private-retry').hidden = false;
    return false;
  }
})().catch(() => {
  document.getElementById('private-status').textContent = '題庫資料未能載入，請確認本機檔案完整。';
  return false;
});
