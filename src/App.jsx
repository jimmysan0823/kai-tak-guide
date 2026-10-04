/**
 * 啟德站周邊地標與交通轉乘指南 (Kai Tak Transit & Landmark Guide)  v3（按官方指南 09/2026 核對）
 * React + Tailwind CSS + lucide-react + framer-motion + Supabase
 * 依賴：npm i framer-motion lucide-react @supabase/supabase-js
 */
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { createClient } from '@supabase/supabase-js';
import { AlertTriangle, ArrowLeftRight, ArrowRight, Bus, CheckCircle2, ChevronDown, Clock, Database, ExternalLink, Factory, Footprints, Globe, GraduationCap, HeartPulse, Home, Info, Landmark, LayoutGrid, Lock, LogOut, MapPin, Navigation, Pencil, Plus, RefreshCw, Search, Ship, ShoppingBag, Ticket, Train, Trash2, Unlock, Wallet, X } from 'lucide-react';

const ENV = import.meta.env;

/* =====================================================================
 *  Supabase 雲端資料庫
 *  ---------------------------------------------------------------------
 *  環境變數（本機放 .env.local；Vercel 放 Settings → Environment Variables）：
 *    VITE_SUPABASE_URL      Supabase Project URL
 *    VITE_SUPABASE_ANON_KEY Supabase anon / publishable key
 *    VITE_ADMIN_EMAIL       Supabase Authentication 內建立的管理員電郵
 *
 *  資料表（如已建立可略過）：
 *   create table landmarks (
 *     id text primary key, category text not null, exit text not null,
 *     name jsonb not null, "desc" jsonb not null, tip jsonb,
 *     map_query text, sort int default 0, updated_at timestamptz default now()
 *   );
 *   alter table landmarks enable row level security;
 *   create policy "public read" on landmarks for select using (true);
 *   create policy "admin write" on landmarks for all using (auth.role() = 'authenticated');
 *
 *  未設定環境變數時，系統自動改用瀏覽器本機儲存，管理員密碼為 admin123。
 * ===================================================================== */
const SUPABASE_URL = ENV.VITE_SUPABASE_URL;
const SUPABASE_KEY = ENV.VITE_SUPABASE_ANON_KEY;
const ADMIN_EMAIL = ENV.VITE_ADMIN_EMAIL || '';
const supabase = createClient && SUPABASE_URL && SUPABASE_KEY ? createClient(SUPABASE_URL, SUPABASE_KEY) : null;

const LS_KEY = 'kat-landmarks-v2';
const toRow = (x, i) => ({ id: x.id, category: x.category, exit: x.exit, name: x.name, desc: x.desc, tip: x.tip, map_query: x.mapQuery, sort: i });
const fromRow = (r) => ({ id: r.id, category: r.category, exit: r.exit, name: r.name, desc: r.desc, tip: r.tip || {}, mapQuery: r.map_query });

const db = {
  mode: supabase ? 'cloud' : 'local',
  async list() {
    if (supabase) {
      const { data, error } = await supabase.from('landmarks').select('*').order('sort', { ascending: true });
      if (error) throw error;
      return data.map(fromRow);
    }
    try { const raw = localStorage.getItem(LS_KEY); if (raw) return JSON.parse(raw); } catch {}
    return null;
  },
  async upsert(item, all) {
    if (supabase) {
      const { error } = await supabase.from('landmarks').upsert(toRow(item, all.findIndex((x) => x.id === item.id)));
      if (error) throw error;
    }
    try { localStorage.setItem(LS_KEY, JSON.stringify(all)); } catch {}
  },
  async remove(id, all) {
    if (supabase) {
      const { error } = await supabase.from('landmarks').delete().eq('id', id);
      if (error) throw error;
    }
    try { localStorage.setItem(LS_KEY, JSON.stringify(all)); } catch {}
  },
  // 雲端資料表為空時，自動上載預設資料（需已登入管理員）
  async seedIfEmpty(seed) {
    if (!supabase) return false;
    const { count, error } = await supabase.from('landmarks').select('id', { count: 'exact', head: true });
    if (error) throw error;
    if (count === 0) {
      const { error: e2 } = await supabase.from('landmarks').insert(seed.map(toRow));
      if (e2) throw e2;
      return true;
    }
    return false;
  },
  // 以最新預設資料完全取代雲端資料（管理員「同步」按鈕）
  async replaceAll(seed) {
    if (supabase) {
      const { error: e1 } = await supabase.from('landmarks').delete().neq('id', '__none__');
      if (e1) throw e1;
      const { error: e2 } = await supabase.from('landmarks').insert(seed.map(toRow));
      if (e2) throw e2;
    }
    try { localStorage.setItem(LS_KEY, JSON.stringify(seed)); } catch {}
  },
};

const ADMIN_PASSWORD = 'admin123'; // 只在未連接 Supabase 時使用
// 先試 Vercel 代理（vercel.json rewrites），再試直接連線
const MTR_SCHEDULE_URLS = ['/api/mtr-schedule?line=TML&sta=KAT', 'https://rt.data.gov.hk/v1/transport/mtr/getSchedule.php?line=TML&sta=KAT'];
const MTR_FARE_URLS = ['/api/mtr-fares', 'https://opendata.mtr.com.hk/data/mtr_lines_fares.csv'];
const TICKET_URL = 'https://www.mtr.com.hk/ch/customer/tickets/index.html';
const mapsUrl = (q) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;

async function fetchFirst(urls, parse, timeout = 6000) {
  for (const u of urls) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeout);
      const res = await fetch(u, { signal: ctrl.signal });
      clearTimeout(timer);
      if (!res.ok) continue;
      const out = await parse(res);
      if (out) return out;
    } catch {}
  }
  return null;
}

/* ============================ 介面文字 ============================ */
const LANGS = [
  { code: 'zh', label: '中文' },
  { code: 'en', label: 'English' },
  { code: 'ko', label: '한국어' },
  { code: 'ja', label: '日本語' },
];

const UI = {
  zh: {
    title: '啟德站周邊地標與交通轉乘指南', station: '啟德', stationAlt: 'Kai Tak', line: '屯馬綫',
    tabLand: '周邊地標與接駁', tabMtr: '港鐵轉乘與車票',
    searchPh: '搜尋地點、出口或關鍵字，例如「C」、「醫院」', count: '共 {n} 個地點',
    tip: '轉乘／步行小貼士', navigate: 'Google 地圖導航', exit: '出口',
    admin: '管理員登入', adminOn: '管理模式', logout: '登出', addNew: '新增地標地點',
    edit: '編輯', del: '刪除', confirmDel: '確定刪除「{name}」？此操作無法復原。',
    cancel: '取消', save: '儲存', login: '登入', pwPh: '輸入管理員密碼', pwWrong: '密碼不正確，請再試一次。',
    noResult: '找不到相符地點。試試輸入出口代號（如 D）或清除篩選。', clear: '清除篩選',
    arrivals: '實時到站班次', toWKS: '往 烏溪沙', toTUM: '往 屯門', plat: '月台', arriving: '即將抵達',
    live: '港鐵開放數據', sim: '模擬班次（未能連線至港鐵 API）', updated: '更新於',
    fareCalc: '熱門轉乘與車費', from: '由啟德出發往', route: '建議路線', octopus: '成人八達通', single: '單程車票', time: '預計車程', mins: '分鐘',
    fareNote: '車費為參考價，以港鐵官網公佈為準。', passFree: '全月通加強版：全程免費', passDisc: '全月通加強版：範圍外路程 75 折',
    tickets: '車站票務產品', officialLink: '前往港鐵官網查看最新車票詳情',
    service: '服務指引', formAdd: '新增地標地點', formEdit: '編輯地標地點',
    fName: '名稱', fDesc: '簡介', fTip: '轉乘貼士', fCat: '分類', fExit: '建議出口', fQuery: 'Google Maps 搜尋關鍵字',
    required: '請填寫中文名稱及出口。', saved: '已儲存', deleted: '已刪除', reset: '還原預設資料',
    gtFail: 'Google 翻譯需於正式網域部署後啟用', storeLocal: '資料暫存於本機瀏覽器', storeCloud: '已連接 Supabase',
  },
  en: {
    title: 'Kai Tak Transit & Landmark Guide', station: 'Kai Tak', stationAlt: '啟德', line: 'Tuen Ma Line',
    tabLand: 'Landmarks & Connections', tabMtr: 'MTR Routes & Tickets',
    searchPh: 'Search places, exits or keywords, e.g. "C", "hospital"', count: '{n} places',
    tip: 'Transfer / walking tip', navigate: 'Navigate in Google Maps', exit: 'Exit',
    admin: 'Admin sign-in', adminOn: 'Admin mode', logout: 'Sign out', addNew: 'Add landmark',
    edit: 'Edit', del: 'Delete', confirmDel: 'Delete "{name}"? This cannot be undone.',
    cancel: 'Cancel', save: 'Save', login: 'Sign in', pwPh: 'Admin password', pwWrong: 'Wrong password. Try again.',
    noResult: 'No matching places. Try an exit code (e.g. D) or clear the filters.', clear: 'Clear filters',
    arrivals: 'Next trains', toWKS: 'To Wu Kai Sha', toTUM: 'To Tuen Mun', plat: 'Platform', arriving: 'Arriving',
    live: 'MTR Open Data', sim: 'Simulated (MTR API unreachable)', updated: 'Updated',
    fareCalc: 'Popular trips & fares', from: 'From Kai Tak to', route: 'Suggested route', octopus: 'Adult Octopus', single: 'Single journey', time: 'Journey time', mins: 'min',
    fareNote: 'Fares are for reference only. See MTR for official fares.', passFree: 'Monthly Pass Extra: free', passDisc: 'Monthly Pass Extra: 25% off outside zone',
    tickets: 'Tickets at this station', officialLink: 'See latest ticket details on MTR website',
    service: 'Station services', formAdd: 'Add landmark', formEdit: 'Edit landmark',
    fName: 'Name', fDesc: 'Description', fTip: 'Transfer tip', fCat: 'Category', fExit: 'Best exit', fQuery: 'Google Maps search keyword',
    required: 'Chinese name and exit are required.', saved: 'Saved', deleted: 'Deleted', reset: 'Restore default data',
    gtFail: 'Google Translate activates once deployed on your own domain', storeLocal: 'Saved in this browser', storeCloud: 'Connected to Supabase',
  },
  ko: {
    title: '카이탁역 주변 명소 및 환승 가이드', station: '카이탁', stationAlt: '啟德', line: '툰마선',
    tabLand: '주변 명소·환승', tabMtr: 'MTR 환승·승차권',
    searchPh: '장소, 출구, 키워드 검색 (예: "C", "병원")', count: '{n}곳',
    tip: '환승·도보 팁', navigate: 'Google 지도 길찾기', exit: '출구',
    admin: '관리자 로그인', adminOn: '관리자 모드', logout: '로그아웃', addNew: '명소 추가',
    edit: '편집', del: '삭제', confirmDel: '"{name}"을(를) 삭제할까요? 되돌릴 수 없습니다.',
    cancel: '취소', save: '저장', login: '로그인', pwPh: '관리자 비밀번호', pwWrong: '비밀번호가 틀렸습니다.',
    noResult: '일치하는 장소가 없습니다. 출구 코드(예: D)를 입력하거나 필터를 해제하세요.', clear: '필터 해제',
    arrivals: '실시간 열차 도착', toWKS: '우카이샤 방면', toTUM: '툰문 방면', plat: '승강장', arriving: '곧 도착',
    live: 'MTR 오픈 데이터', sim: '모의 시간표 (MTR API 연결 불가)', updated: '업데이트',
    fareCalc: '인기 환승 경로·요금', from: '카이탁 출발 →', route: '추천 경로', octopus: '성인 옥토퍼스', single: '편도 승차권', time: '소요 시간', mins: '분',
    fareNote: '요금은 참고용이며 MTR 공식 요금을 따릅니다.', passFree: '월정액 패스 엑스트라: 무료', passDisc: '월정액 패스 엑스트라: 구간 외 25% 할인',
    tickets: '역 승차권 상품', officialLink: 'MTR 웹사이트에서 최신 승차권 정보 보기',
    service: '역 서비스 안내', formAdd: '명소 추가', formEdit: '명소 편집',
    fName: '이름', fDesc: '소개', fTip: '환승 팁', fCat: '분류', fExit: '추천 출구', fQuery: 'Google 지도 검색어',
    required: '중국어 이름과 출구는 필수입니다.', saved: '저장됨', deleted: '삭제됨', reset: '기본 데이터 복원',
    gtFail: 'Google 번역은 정식 도메인 배포 후 활성화됩니다', storeLocal: '이 브라우저에 저장됨', storeCloud: 'Supabase 연결됨',
  },
  ja: {
    title: '啓徳駅 周辺ランドマーク＆乗換ガイド', station: '啓徳', stationAlt: 'Kai Tak', line: '屯馬線',
    tabLand: '周辺ランドマーク・乗換', tabMtr: 'MTR乗換・きっぷ',
    searchPh: '場所・出口・キーワードで検索（例：「C」「病院」）', count: '{n} 件',
    tip: '乗換・徒歩のヒント', navigate: 'Google マップでナビ', exit: '出口',
    admin: '管理者ログイン', adminOn: '管理モード', logout: 'ログアウト', addNew: 'ランドマークを追加',
    edit: '編集', del: '削除', confirmDel: '「{name}」を削除しますか？元に戻せません。',
    cancel: 'キャンセル', save: '保存', login: 'ログイン', pwPh: '管理者パスワード', pwWrong: 'パスワードが違います。',
    noResult: '該当する場所がありません。出口コード（例：D）で検索するか、絞り込みを解除してください。', clear: '絞り込み解除',
    arrivals: 'リアルタイム発車案内', toWKS: '烏溪沙 方面', toTUM: '屯門 方面', plat: 'ホーム', arriving: 'まもなく到着',
    live: 'MTR オープンデータ', sim: 'シミュレーション（MTR API 接続不可）', updated: '更新',
    fareCalc: '人気の乗換ルートと運賃', from: '啓徳から', route: 'おすすめルート', octopus: '大人オクトパス', single: '片道きっぷ', time: '所要時間', mins: '分',
    fareNote: '運賃は参考値です。正式運賃は MTR 公式サイトをご確認ください。', passFree: '全月通加強版：無料', passDisc: '全月通加強版：範囲外25%割引',
    tickets: '駅で使えるきっぷ', officialLink: 'MTR 公式サイトで最新のきっぷ情報を見る',
    service: '駅サービス案内', formAdd: 'ランドマークを追加', formEdit: 'ランドマークを編集',
    fName: '名称', fDesc: '紹介', fTip: '乗換のヒント', fCat: '分類', fExit: 'おすすめ出口', fQuery: 'Google マップ検索キーワード',
    required: '中国語名と出口は必須です。', saved: '保存しました', deleted: '削除しました', reset: '初期データに戻す',
    gtFail: 'Google 翻訳は独自ドメインへのデプロイ後に有効になります', storeLocal: 'このブラウザに保存', storeCloud: 'Supabase に接続済み',
  },
};
const UI_EXTRA = {
  zh: {
    stationPick: '選擇目的地車站', allLines: '所有路綫', stationSearch: '輸入車站名稱或代號，例如「沙田」、「Central」、「TST」',
    stops: '{n} 站', dirTo: '往{to}方向', walkTo: '步行至{to}', transferNone: '直達，毋須轉車', transferAt: '轉車站：{list}',
    fareOfficial: '港鐵開放數據車費', fareEstimate: '估算車費（未能載入官方車費表）', fareLoading: '正在載入官方車費…',
    aelNote: '機場快綫部分車費為估算，請以港鐵官網為準。', atKat: '你已經身處啟德站。', noStation: '找不到相符車站。', timeNote: '不包括候車時間',
    csc: '客務中心：位於啟德站大堂中間（閘外區域，洗手間旁邊）', tvm: '自動售票機：可購買單程車票及港鐵都會票，並為八達通增值',
    sync: '以最新官方出口資料覆蓋', syncConfirm: '將刪除雲端所有地標，並以最新官方出口資料（{n} 個地點）取代。此操作無法復原，確定？',
    synced: '已同步最新官方出口資料', seeded: '已上載預設資料', email: '管理員電郵', signingIn: '登入中…', stationCount: '{n} 個車站',
  },
  en: {
    stationPick: 'Choose a destination station', allLines: 'All lines', stationSearch: 'Station name or code, e.g. "Sha Tin", "中環", "TST"',
    stops: '{n} stops', dirTo: 'towards {to}', walkTo: 'Walk to {to}', transferNone: 'Direct, no change needed', transferAt: 'Change at: {list}',
    fareOfficial: 'MTR Open Data fare', fareEstimate: 'Estimated fare (official fare table unavailable)', fareLoading: 'Loading official fares…',
    aelNote: 'Airport Express portion is estimated. Check MTR for official fares.', atKat: 'You are already at Kai Tak.', noStation: 'No matching station.', timeNote: 'Excludes waiting time',
    csc: 'Customer Service Centre: middle of the concourse (unpaid area, next to the toilets)', tvm: 'Ticket machines: single journey tickets, MTR City Saver and Octopus top-up',
    sync: 'Replace with latest official exit data', syncConfirm: 'This deletes all cloud landmarks and replaces them with the latest official exit data ({n} places). This cannot be undone. Continue?',
    synced: 'Latest official exit data synced', seeded: 'Default data uploaded', email: 'Admin email', signingIn: 'Signing in…', stationCount: '{n} stations',
  },
  ko: {
    stationPick: '목적지 역 선택', allLines: '전체 노선', stationSearch: '역 이름 또는 코드 입력 (예: "Sha Tin", "TST")',
    stops: '{n}개 역', dirTo: '{to} 방면', walkTo: '{to}까지 도보', transferNone: '직통, 환승 없음', transferAt: '환승역: {list}',
    fareOfficial: 'MTR 오픈 데이터 요금', fareEstimate: '예상 요금 (공식 요금표 불러오기 실패)', fareLoading: '공식 요금 불러오는 중…',
    aelNote: '공항철도 구간 요금은 예상치입니다. MTR 공식 요금을 확인하세요.', atKat: '이미 카이탁역에 있습니다.', noStation: '일치하는 역이 없습니다.', timeNote: '대기 시간 제외',
    csc: '고객서비스센터: 역 대합실 중앙 (개찰구 밖, 화장실 옆)', tvm: '자동발매기: 편도 승차권, MTR 시티 세이버 구매 및 옥토퍼스 충전',
    sync: '최신 공식 출구 데이터로 덮어쓰기', syncConfirm: '클라우드의 모든 명소를 삭제하고 최신 공식 출구 데이터({n}곳)로 교체합니다. 되돌릴 수 없습니다. 계속할까요?',
    synced: '최신 공식 출구 데이터 동기화 완료', seeded: '기본 데이터 업로드 완료', email: '관리자 이메일', signingIn: '로그인 중…', stationCount: '{n}개 역',
  },
  ja: {
    stationPick: '目的地の駅を選択', allLines: '全路線', stationSearch: '駅名またはコードを入力（例：「沙田」「Central」「TST」）',
    stops: '{n} 駅', dirTo: '{to} 方面', walkTo: '{to} まで徒歩', transferNone: '直通・乗換なし', transferAt: '乗換駅：{list}',
    fareOfficial: 'MTR オープンデータ運賃', fareEstimate: '推定運賃（公式運賃表を読み込めません）', fareLoading: '公式運賃を読み込み中…',
    aelNote: 'エアポート・エクスプレス区間の運賃は推定値です。MTR 公式サイトをご確認ください。', atKat: 'すでに啓徳駅にいます。', noStation: '該当する駅がありません。', timeNote: '待ち時間を含みません',
    csc: 'カスタマーサービスセンター：コンコース中央（改札外、トイレ隣）', tvm: '自動券売機：片道きっぷ・MTR City Saver の購入、オクトパスのチャージ',
    sync: '最新の公式出口データで上書き', syncConfirm: 'クラウド上の全ランドマークを削除し、最新の公式出口データ（{n} 件）に置き換えます。元に戻せません。続けますか？',
    synced: '最新の公式出口データを同期しました', seeded: '初期データをアップロードしました', email: '管理者メール', signingIn: 'ログイン中…', stationCount: '{n} 駅',
  },
};
Object.keys(UI_EXTRA).forEach((l) => Object.assign(UI[l], UI_EXTRA[l]));
const fmt = (s, v) => s.replace(/\{(\w+)\}/g, (_, k) => v[k] ?? '');
const tx = (obj, lang) => (obj && (obj[lang] || (lang === 'ja' ? obj.zh || obj.en : obj.en || obj.zh))) || '';

/* ============================ 分類 ============================ */
const CATS = [
  { id: 'all', Icon: LayoutGrid, label: { zh: '全部', en: 'All', ko: '전체', ja: 'すべて' } },
  { id: 'shopping', Icon: ShoppingBag, emoji: '🛍️', label: { zh: '文娛/購物', en: 'Leisure & Shopping', ko: '쇼핑·문화', ja: 'ショッピング' } },
  { id: 'residential', Icon: Home, emoji: '🏠', label: { zh: '住宅屋苑', en: 'Residential', ko: '주거단지', ja: '住宅' } },
  { id: 'education', Icon: GraduationCap, emoji: '🏫', label: { zh: '學校/教育', en: 'Schools', ko: '학교·교육', ja: '学校・教育' } },
  { id: 'government', Icon: Landmark, emoji: '🏛️', label: { zh: '政府/公共', en: 'Government', ko: '정부·공공', ja: '政府・公共' } },
  { id: 'medical', Icon: HeartPulse, emoji: '🏥', label: { zh: '醫療/健康', en: 'Medical', ko: '의료·건강', ja: '医療・健康' } },
  { id: 'industry', Icon: Factory, emoji: '🏭', label: { zh: '工商業區', en: 'Business', ko: '상공업지구', ja: '商工業エリア' } },
  { id: 'sports', Icon: Ship, emoji: '🚢', label: { zh: '體育/景點', en: 'Sports & Sights', ko: '스포츠·명소', ja: 'スポーツ・観光' } },
  { id: 'transport', Icon: Bus, emoji: '🚌', label: { zh: '接駁交通', en: 'Transport', ko: '환승 교통', ja: '交通乗換' } },
];
const catById = (id) => CATS.find((c) => c.id === id) || CATS[0];
const EXITS = ['A', 'B1', 'B2', 'C', 'D', 'B1/B2'];

/* ============================ 地標資料（港鐵啟德站官方指南 09/2026 逐項核對） ============================ */
// 韓文／日文簡介按分類自動生成，可於 CMS 後台逐項改寫
const CAT_DESC = {
  shopping: { ko: '쇼핑·식당 시설', ja: 'ショッピング・飲食施設' },
  residential: { ko: '주거 단지', ja: '住宅' },
  education: { ko: '교육 시설', ja: '教育施設' },
  government: { ko: '정부·공공·복지 시설', ja: '政府・公共・福祉施設' },
  medical: { ko: '의료 시설', ja: '医療施設' },
  industry: { ko: '상업·오피스 빌딩', ja: '商業・オフィスビル' },
  sports: { ko: '스포츠·공원·명소', ja: 'スポーツ・公園・観光スポット' },
  transport: { ko: '대중교통 환승 시설', ja: '公共交通の乗換施設' },
};
const EXIT_TIP = {
  A: { zh: 'A 出口連接啟德車站廣場及公共運輸交匯處，出站後按街道指示牌前往。', en: 'Exit A leads to Kai Tak Station Square and the public transport interchange. Follow the street signs.', ko: 'A 출구는 카이탁역 광장과 환승센터로 연결됩니다. 거리 표지판을 따라가세요.', ja: 'A出口は啓徳駅前広場と公共交通ターミナルに通じています。案内標識に従ってください。' },
  B1: { zh: 'B1 出口可經行人天橋前往新蒲崗及東啟德一帶。', en: 'From Exit B1, take the footbridge towards San Po Kong and East Kai Tak.', ko: 'B1 출구에서 보행 육교를 이용해 산포콩·동카이탁 방면으로 이동하세요.', ja: 'B1出口から歩道橋で新蒲崗・東啓徳方面へ。' },
  B2: { zh: 'B2 出口直達天璽天，亦可經行人天橋前往新蒲崗。', en: 'Exit B2 leads straight to Tin Sai Tin, with a footbridge to San Po Kong.', ko: 'B2 출구는 틴사이틴으로 바로 연결되며, 육교로 산포콩에 갈 수 있습니다.', ja: 'B2出口は天璽天に直結。歩道橋で新蒲崗へも行けます。' },
  C: { zh: 'C 出口往 AIRSIDE 一帶及新蒲崗東面（太子道東沿線）。', en: 'Exit C leads towards AIRSIDE and the eastern side of San Po Kong along Prince Edward Road East.', ko: 'C 출구는 AIRSIDE 및 산포콩 동쪽(프린스 에드워드 로드 이스트) 방면입니다.', ja: 'C出口はAIRSIDE方面と新蒲崗東側（太子道東沿い）へ。' },
  D: { zh: 'D 出口往啟德體育園、跑道區方向及 D 出口公共運輸交匯處。', en: 'Exit D leads to Kai Tak Sports Park, the runway area and the Exit D transport interchange.', ko: 'D 출구는 카이탁 스포츠파크, 활주로 지구 및 D 출구 환승센터 방면입니다.', ja: 'D出口は啓徳スポーツパーク、ランウェイ地区、D出口交通ターミナル方面へ。' },
  'B1/B2': { zh: '可經 B1 或 B2 出口的行人天橋前往。', en: 'Reach it via the footbridge from Exit B1 or B2.', ko: 'B1 또는 B2 출구의 보행 육교를 이용하세요.', ja: 'B1またはB2出口の歩道橋を利用。' },
};

// mk(id, 分類, 出口, 中文名, 英文名, 中文簡介, 英文簡介, 專屬貼士 [zh, en]?, 地圖關鍵字?)
const mk = (id, category, exit, zh, en, dZh, dEn, tip, q) => ({
  id, category, exit,
  name: { zh, en, ko: en, ja: zh },
  desc: {
    zh: dZh, en: dEn,
    ko: `${CAT_DESC[category].ko}. 카이탁역 ${exit} 출구 이용.`,
    ja: `${CAT_DESC[category].ja}。啓徳駅 ${exit} 出口が便利。`,
  },
  tip: tip ? { zh: tip[0], en: tip[1] } : { ...EXIT_TIP[exit] },
  mapQuery: q || `${zh} 香港`,
});

// 以下 80 個地點按港鐵啟德站官方指南（09/2026）逐項核對：中英文名稱、建議出口、分類
// 官方「主要大廈」→ 🏭 工商業區；官方「公共服務及設施」→ 按性質分入 🏛️ 政府/公共、🏥 醫療、🚢 體育/景點
const SEED = [
  /* ---------- 文娛及購物 Leisure / Shopping（1–11） ---------- */
  mk('s01-airside', 'shopping', 'C', 'AIRSIDE', 'AIRSIDE', '啟德地標式商場，集購物、餐飲及天台花園。', 'Landmark mall with shopping, dining and a rooftop garden.', null, 'AIRSIDE 啟德'),
  mk('s02-ching-long', 'shopping', 'A', '晴朗商場', 'Ching Long Shopping Centre', '服務啟晴邨及德朗邨的屋邨商場，設街市及食肆。', 'Estate mall for Kai Ching and Tak Long, with a wet market and eateries.'),
  mk('s03-cullinan-sky-mall', 'shopping', 'B2', '天璽天Mall', 'Cullinan Sky Mall', '天璽天基座商場，提供日常購物及餐飲。', 'Podium mall of Cullinan Sky for daily shopping and dining.', null, 'Cullinan Sky Mall Kai Tak'),
  mk('s04-dining-cove', 'shopping', 'D', '美食海灣', 'Dining Cove', '啟德體育園一帶的餐飲區。', 'Dining zone at Kai Tak Sports Park.', null, 'Dining Cove Kai Tak'),
  mk('s05-kt-mall', 'shopping', 'D', '啟德零售館', 'Kai Tak Mall', '啟德體育園內的零售及餐飲設施，活動日人流較多。', 'Retail and dining at Kai Tak Sports Park; busy on event days.', null, 'Kai Tak Mall'),
  mk('s06-mikiki', 'shopping', 'C', 'Mikiki', 'Mikiki', '設超市、戲院及多元食肆的商場。', 'Mall with a supermarket, cinema and eateries.', null, 'Mikiki 新蒲崗'),
  mk('s07-richland-mall', 'shopping', 'A', '麗晶商場', 'Richland Gardens Shopping Centre', '九龍灣麗晶花園的屋苑商場。', 'Shopping centre of Richland Gardens in Kowloon Bay.'),
  mk('s08-twins1', 'shopping', 'B1', '雙子匯1期(崇光百貨)', 'The Twins Tower I (SOGO)', '崇光百貨啟德店，涵蓋時裝、美妝及超市。', 'SOGO department store with fashion, beauty and a supermarket.', null, 'SOGO 啟德'),
  mk('s09-twins2', 'shopping', 'A', '雙子匯2期(三道)', 'The Twins Tower II (SNDO)', '雙子匯第二期零售及餐飲設施。', 'Retail and dining in The Twins Tower II.', null, '雙子匯 啟德'),
  mk('s10-uplace', 'shopping', 'D', 'U PLACE Riverside', 'U PLACE Riverside', '沿啟德河畔的商場。', 'Riverside shopping mall by the Kai Tak River.', null, 'U PLACE Riverside 啟德'),
  mk('s11-yuexiu', 'shopping', 'C', '越秀廣場', 'Yue Xiu Plaza', '商場及商業大廈。', 'Shopping and commercial building.'),

  /* ---------- 主要大廈 Major buildings（12–20） ---------- */
  mk('m12-aia', 'industry', 'C', '友邦九龍金融中心', 'AIA Financial Centre', '甲級商業大廈。', 'Grade A office tower.'),
  mk('m13-emsd', 'industry', 'A', '機電工程署總部大樓', 'Electrical and Mechanical Services Department Headquarters', '機電工程署總部，設教育徑供預約參觀。', 'EMSD headquarters, with an education path open by appointment.'),
  mk('m14-port33', 'industry', 'C', 'PORT 33', 'PORT 33', '商業及辦公大樓。', 'Commercial office building.', null, 'PORT 33 新蒲崗'),
  mk('m15-skyline', 'industry', 'A', '宏天廣場', 'Skyline Tower', '九龍灣甲級商業大廈。', 'Grade A office tower in Kowloon Bay.'),
  mk('m16-stelux', 'industry', 'C', '寶光商業中心', 'Stelux House', '商業及辦公大樓。', 'Commercial office building.'),
  mk('m17-tl-carpark', 'industry', 'A', '德朗邨多層停車場', 'Tak Long Estate Multi-storey Car Park', '德朗邨的多層停車場。', 'Multi-storey car park at Tak Long Estate.'),
  mk('m18-tid', 'industry', 'C', '工業貿易大樓', 'Trade and Industry Tower', '工業貿易署等政府部門辦公大樓。', 'Government offices including the Trade and Industry Department.'),
  mk('m19-trium-hub', 'industry', 'B1', '駿星企業中心', 'Trium Hub', '商業及辦公大樓。', 'Commercial office building.', null, 'Trium Hub Kai Tak'),
  mk('m20-trium-lab', 'industry', 'B1', '駿星創科中心', 'Trium Lab', '創科及辦公大樓。', 'Innovation and office building.', null, 'Trium Lab Kai Tak'),

  /* ---------- 公共服務及設施 Public facilities & services（21–40） ---------- */
  mk('p21-green-tl', 'government', 'A', '綠在德朗', 'GREEN@TAK LONG', '社區回收環保站，收集多類回收物。', 'Community recycling store for various recyclables.'),
  mk('p22-skh-youth', 'government', 'A', '香港聖公會九龍城青少年綜合服務中心', 'H.K.S.K.H. Kowloon City Children and Youth Integrated Service Centre', '為兒童及青少年提供輔導及活動的社會服務中心。', 'Social services centre offering counselling and activities for young people.'),
  mk('p23-hkch', 'medical', 'D', '香港兒童醫院', "Hong Kong Children's Hospital", '全港首間專科兒童醫院。', "Hong Kong's dedicated children's hospital.",
    ['可於 D 出口步行前往；或於 C 出口乘搭 22S，A 出口設復康穿梭巴士站。', 'Walk from Exit D, take route 22S from Exit C, or use the Rehabus feeder stop at Exit A.']),
  mk('p24-irc', 'government', 'C', '稅務中心', 'Inland Revenue Centre', '稅務局總部所在地。', 'Headquarters of the Inland Revenue Department.'),
  mk('p25-kt-arena', 'sports', 'D', '啟德體藝館', 'Kai Tak Arena', '室內體育及文娛表演場館。', 'Indoor arena for sports and performances.'),
  mk('p26-avenue-park', 'sports', 'A', '啟德大道公園', 'Kai Tak Avenue Park', '沿啟德大道而建的休憩公園。', 'Landscaped park along Kai Tak Avenue.'),
  mk('p27-kt-hall', 'government', 'C', '啟德社區會堂', 'Kai Tak Community Hall', '供區內團體舉辦活動的社區會堂。', 'Community hall for local events and activities.'),
  mk('p28-ekt-playground', 'sports', 'B1', '東啟德遊樂場', 'Kai Tak East Playground', '設球場及兒童遊樂設施的遊樂場。', "Playground with sports courts and children's play facilities."),
  mk('p29-ekt-sports', 'sports', 'B1', '東啟德體育館', 'Kai Tak East Sports Centre', '康文署室內體育館。', 'LCSD indoor sports centre.'),
  mk('p30-kt-hosp', 'medical', 'D', '啟德醫院', 'Kai Tak Hospital', '已正式開幕營運的大型急症醫院。', 'Major acute hospital, now open.',
    ['可於 D 出口步行前往；或於 C 出口乘搭 22S，A 出口設復康穿梭巴士站。', 'Walk from Exit D, take route 22S from Exit C, or use the Rehabus feeder stop at Exit A.']),
  mk('p31-ktsp', 'sports', 'D', '啟德體育園', 'Kai Tak Sports Park', '全港最大型體育及康樂設施。', "Hong Kong's largest sports and recreation venue.",
    ['D 出口經有蓋通道前往，大型活動散場時請預留排隊時間。', 'Covered walkway from Exit D. Allow extra time after big events.'], '啟德體育園'),
  mk('p32-kt-stadium', 'sports', 'D', '啟德主場館', 'Kai Tak Stadium', '可容納約五萬人、設開合式上蓋的主場館。', 'About 50,000-seat stadium with a retractable roof.'),
  mk('p33-station-sq', 'sports', 'A', '啟德車站廣場', 'Kai Tak Station Square', '車站上蓋的大型綠化休憩空間。', 'Large landscaped open space above the station.', ['A 出口出站即達。', 'Right outside Exit A.']),
  mk('p34-kt-ysg', 'sports', 'D', '啟德青年運動場', 'Kai Tak Youth Sports Ground', '設田徑跑道及足球場的運動場。', 'Sports ground with running track and football pitch.'),
  mk('p35-kb-park', 'sports', 'A', '九龍灣公園', 'Kowloon Bay Park', '設球場及休憩設施的地區公園。', 'District park with sports courts and sitting areas.'),
  mk('p36-police', 'government', 'B1', '東九龍總區總部及行動基地暨牛頭角分區警署', 'Kowloon East Regional Headquarters and Operational Base-cum-Ngau Tau Kok Divisional Police Station', '東九龍總區警察總部、行動基地及分區警署。', 'Police regional headquarters, operational base and divisional station.'),
  mk('p37-plk-elderly', 'government', 'A', '保良局溫林美賢耆暉中心', 'PLK Wan Lam May Yin Shirley Neighbourhood Elderly Centre', '為區內長者提供服務的鄰舍中心。', 'Neighbourhood centre serving local elderly residents.'),
  mk('p38-robert-black', 'medical', 'C', '柏立基普通科門診診所', 'Robert Black General Out-patient Clinic', '醫管局普通科門診。', 'Hospital Authority general out-patient clinic.'),
  mk('p39-sklr-playground', 'sports', 'C', '石鼓壟道遊樂場', 'Shek Ku Lung Road Playground', '區內休憩及運動場地。', 'Local playground and sports ground.'),
  mk('p40-twgh-tungpo', 'government', 'C', '東華三院東蒲', 'TWGHs TungPo', '東華三院社會服務單位。', 'Tung Wah Group of Hospitals social service unit.'),

  /* ---------- 住宅 Residential（41–63） ---------- */
  mk('r41-wun-yin', 'residential', 'A', '煥然壹居', '煥然壹居', '市建局資助出售房屋項目。', 'Subsidised sale flats by the Urban Renewal Authority.'),
  mk('r42-cullinan-sky', 'residential', 'B2', '天璽天', 'Cullinan Sky', '車站旁私人住宅發展項目。', 'Private residential development next to the station.', null, 'Cullinan Sky Kai Tak'),
  mk('r43-henley-park', 'residential', 'D', 'Henley Park', 'Henley Park', '啟德私人住宅項目。', 'Private residential development in Kai Tak.', null, 'Henley Park Kai Tak'),
  mk('r44-k-city', 'residential', 'A', '嘉匯', 'K City', '啟德私人住宅項目。', 'Private residential development in Kai Tak.', null, 'K City Kai Tak'),
  mk('r45-k-summit', 'residential', 'D', '嘉峯匯', 'K.Summit', '啟德私人住宅項目。', 'Private residential development in Kai Tak.', null, 'K.Summit Kai Tak'),
  mk('r46-kai-ching', 'residential', 'A', '啟晴邨', 'Kai Ching Estate', '啟德首批公共屋邨之一。', 'One of the first public housing estates in Kai Tak.'),
  mk('r47-kai-long', 'residential', 'A', '啟朗苑', 'Kai Long Court', '居者有其屋屋苑。', 'Home Ownership Scheme court.'),
  mk('r48-king-tai', 'residential', 'B1', '景泰苑', 'King Tai Court', '新蒲崗居屋屋苑。', 'Home Ownership Scheme court in San Po Kong.'),
  mk('r49-light-ph', 'residential', 'D', '世運道簡約公屋', 'Light Public Housing at Olympic Avenue', '世運道簡約公屋項目。', 'Light public housing on Olympic Avenue.'),
  mk('r50-monaco', 'residential', 'D', 'Monaco & Grande Monaco', 'Monaco & Grande Monaco', '啟德跑道區私人住宅。', 'Private residences in the Kai Tak runway area.', null, 'Monaco Kai Tak'),
  mk('r51-monaco-one', 'residential', 'D', 'Monaco One & Monaco Marine', 'Monaco One & Monaco Marine', '啟德跑道區私人住宅。', 'Private residences in the Kai Tak runway area.', null, 'Monaco One Kai Tak'),
  mk('r52-oasis', 'residential', 'D', 'OASIS KAI TAK', 'OASIS KAI TAK', '啟德私人住宅項目。', 'Private residential development in Kai Tak.', null, 'OASIS KAI TAK'),
  mk('r53-one-kt-1', 'residential', 'A', '啟德1號(I)', 'One Kai Tak (I)', '啟德1號第一期私人住宅。', 'Phase I of the One Kai Tak private development.', null, 'One Kai Tak'),
  mk('r54-one-kt-2', 'residential', 'D', '啟德1號(II)', 'One Kai Tak (II)', '啟德1號第二期私人住宅。', 'Phase II of the One Kai Tak private development.', null, 'One Kai Tak II'),
  mk('r55-rhythm', 'residential', 'B1', '采頤花園', 'Rhythm Garden', '新蒲崗私人屋苑。', 'Private estate in San Po Kong.'),
  mk('r56-richland', 'residential', 'A', '麗晶花園', 'Richland Gardens', '九龍灣大型私人屋苑。', 'Large private estate in Kowloon Bay.'),
  mk('r57-tak-long', 'residential', 'A', '德朗邨', 'Tak Long Estate', '與啟晴邨相鄰的公共屋邨。', 'Public housing estate next to Kai Ching Estate.'),
  mk('r58-henley', 'residential', 'D', 'The Henley', 'The Henley', '啟德私人住宅項目。', 'Private residential development in Kai Tak.', null, 'The Henley Kai Tak'),
  mk('r59-latitude', 'residential', 'C', '譽港灣', 'The Latitude', '私人住宅項目。', 'Private residential development.', null, 'The Latitude 譽港灣'),
  mk('r60-t-loft', 'residential', 'A', '啟德東寓', 'T-Loft@Kai Tak', '啟德住宅項目。', 'Residential project in Kai Tak.', null, 'T-Loft@Kai Tak'),
  mk('r61-upper-riverbank', 'residential', 'D', '尚珒溋', 'Upper RiverBank', '啟德私人住宅項目。', 'Private residential development in Kai Tak.', null, 'Upper RiverBank Kai Tak'),
  mk('r62-vibe-centro', 'residential', 'D', '龍譽', 'Vibe Centro', '啟德私人住宅項目。', 'Private residential development in Kai Tak.', null, 'Vibe Centro Kai Tak'),
  mk('r63-victoria-skye', 'residential', 'A', '天寰', 'Victoria Skye', '啟德私人住宅項目。', 'Private residential development in Kai Tak.', null, 'Victoria Skye Kai Tak'),

  /* ---------- 學校 Schools（64–73） ---------- */
  mk('e64-canossa', 'education', 'B1', '嘉諾撒小學(新蒲崗)', 'Canossa Primary School (San Po Kong)', '新蒲崗的天主教小學。', 'Catholic primary school in San Po Kong.'),
  mk('e65-cognitio', 'education', 'A', '文理書院(九龍)', 'Cognitio College (Kowloon)', '區內中學。', 'Secondary school in the district.'),
  mk('e66-lky', 'education', 'C', '李求恩紀念中學', 'Lee Kau Yan Memorial School', '新蒲崗區內中學。', 'Secondary school in San Po Kong.'),
  mk('e67-lst-wcm', 'education', 'C', '樂善堂王仲銘中學', 'Lok Sin Tong Wong Chung Ming Secondary School', '樂善堂辦學的中學。', 'Secondary school run by Lok Sin Tong.'),
  mk('e68-plk-shsn', 'education', 'A', '保良局何壽南小學', 'Po Leung Kuk Stanley Ho Sau Nan Primary School', '啟德發展區內資助小學。', 'Aided primary school in Kai Tak.'),
  mk('e69-ngwah-pri', 'education', 'C', '天主教伍華小學', 'Ng Wah Catholic Primary School', '天主教小學。', 'Catholic primary school.'),
  mk('e70-ngwah-sec', 'education', 'C', '天主教伍華中學', 'Ng Wah Catholic Secondary School', '天主教中學。', 'Catholic secondary school.'),
  mk('e71-skh-hc', 'education', 'A', '聖公會聖十架小學', 'S.K.H. Holy Cross Primary School', '聖公會辦學的資助小學。', 'Aided primary school run by the Anglican church.'),
  mk('e72-skh-kl', 'education', 'A', '聖公會九龍灣基樂小學', 'SKH Kowloon Bay Kei Lok Primary School', '聖公會辦學的資助小學。', 'Aided primary school run by the Anglican church.'),
  mk('e73-ymca-kg', 'education', 'A', '港青基信幼稚園(啟晴)', 'YMCA of HK Christian Kindergarten', '位於啟晴邨的幼稚園。', 'Kindergarten at Kai Ching Estate.'),

  /* ---------- 公共交通 Public transport ---------- */
  mk('t-22s-hosp', 'transport', 'C', '往啟德醫院／香港兒童醫院（22S）', "To Kai Tak Hospital / Hong Kong Children's Hospital (22S)", '於 C 出口附近巴士站乘搭 22S 路線。', 'Take route 22S from the bus stop near Exit C.',
    ['C 出口巴士站上車，上車前請核對車頭路線號碼。', 'Board at the bus stop by Exit C. Check the route number before boarding.'], '啟德站 C出口 巴士站'),
  mk('t-rehabus-hosp', 'transport', 'A', '復康穿梭巴士站（往啟德醫院／香港兒童醫院）', "Rehabus Feeder Bus Stop (to Kai Tak Hospital / Hong Kong Children's Hospital)", '為有需要人士提供的復康穿梭巴士站。', 'Rehabus feeder stop for passengers with mobility needs.',
    ['位於 A 出口，輪椅使用者可經升降機往返街面。', 'At Exit A. Wheelchair users can use the lift between street and concourse.'], '啟德站 A出口'),
  mk('t-22m-cruise', 'transport', 'A', '往啟德郵輪碼頭（22M）', 'To Kai Tak Cruise Terminal (22M)', '於 A 出口附近巴士站乘搭 22M 路線。', 'Take route 22M from the bus stop near Exit A.',
    ['A 出口巴士站上車，郵輪抵港日人流較多。', 'Board at the bus stop by Exit A. Expect crowds on cruise days.'], '啟德郵輪碼頭'),
  mk('t-22d-runway', 'transport', 'A', '往啟德跑道區（22D）', 'To Kai Tak Runway Area (22D)', '於 A 出口附近巴士站乘搭 22D 路線。', 'Take route 22D from the bus stop near Exit A.',
    ['A 出口巴士站上車。', 'Board at the bus stop by Exit A.'], '啟德跑道區'),
  mk('t-49-kc-pier', 'transport', 'B1', '往九龍城碼頭（49，只限繁忙時間）', 'To Kowloon City Ferry Pier (49, peak hours only)', '於 B1 出口附近乘搭 49 路線，只於繁忙時間服務。', 'Route 49 from near Exit B1, peak hours only.',
    ['B1 出口上車；此路線只限繁忙時間行駛，非繁忙時間請改用其他交通。', 'Board near Exit B1. Peak hours only; use other transport at other times.'], '九龍城碼頭'),
  mk('t-20-courts', 'transport', 'B1', '往九龍城裁判法院／醫管局大樓（20）', "To Kowloon City Magistrates' Courts / Hospital Authority Building (20)", '於 B1 出口附近乘搭 20 路線。', 'Take route 20 from near Exit B1.',
    ['B1 出口上車。', 'Board near Exit B1.'], '九龍城裁判法院'),
  mk('t-22x-one-victoria', 'transport', 'A', '往維港1號（22X）', 'To One Victoria (22X)', '於 A 出口附近巴士站乘搭 22X 路線。', 'Take route 22X from the bus stop near Exit A.',
    ['A 出口巴士站上車。', 'Board at the bus stop by Exit A.'], '維港1號 啟德'),
];

/* ============================ 港鐵全綫網絡 ============================ */
const LINES = {
  TML: { color: '#9A3B26', name: { zh: '屯馬綫', en: 'Tuen Ma Line', ko: '툰마선', ja: '屯馬線' } },
  KTL: { color: '#00AB4E', name: { zh: '觀塘綫', en: 'Kwun Tong Line', ko: '쿤통선', ja: '観塘線' } },
  TWL: { color: '#E2231A', name: { zh: '荃灣綫', en: 'Tsuen Wan Line', ko: '췬완선', ja: '荃湾線' } },
  ISL: { color: '#0075C2', name: { zh: '港島綫', en: 'Island Line', ko: '아일랜드선', ja: '港島線' } },
  EAL: { color: '#5EB6E4', name: { zh: '東鐵綫', en: 'East Rail Line', ko: '이스트레일선', ja: '東鉄線' } },
  TKL: { color: '#7D499D', name: { zh: '將軍澳綫', en: 'Tseung Kwan O Line', ko: '청관오선', ja: '将軍澳線' } },
  TCL: { color: '#F7943E', name: { zh: '東涌綫', en: 'Tung Chung Line', ko: '퉁청선', ja: '東涌線' } },
  SIL: { color: '#BAC429', name: { zh: '南港島綫', en: 'South Island Line', ko: '사우스아일랜드선', ja: '南港島線' } },
  DRL: { color: '#F550A6', name: { zh: '迪士尼綫', en: 'Disneyland Resort Line', ko: '디즈니랜드 리조트선', ja: 'ディズニーランド・リゾート線' } },
  AEL: { color: '#00888A', name: { zh: '機場快綫', en: 'Airport Express', ko: '공항철도', ja: 'エアポート・エクスプレス' } },
  WALK: { color: '#8A939E', name: { zh: '步行', en: 'Walk', ko: '도보', ja: '徒歩' } },
};
const LINE_ORDER = ['TML', 'KTL', 'TWL', 'ISL', 'EAL', 'TKL', 'TCL', 'SIL', 'DRL', 'AEL'];

// 車站代號 → [中文, 英文]（英文名稱須與港鐵開放數據車費表一致）
const ST = {
  KET: ['堅尼地城', 'Kennedy Town'], HKU: ['香港大學', 'HKU'], SYP: ['西營盤', 'Sai Ying Pun'], SHW: ['上環', 'Sheung Wan'], CEN: ['中環', 'Central'],
  ADM: ['金鐘', 'Admiralty'], WAC: ['灣仔', 'Wan Chai'], CAB: ['銅鑼灣', 'Causeway Bay'], TIH: ['天后', 'Tin Hau'], FOH: ['炮台山', 'Fortress Hill'],
  NOP: ['北角', 'North Point'], QUB: ['鰂魚涌', 'Quarry Bay'], TAK: ['太古', 'Tai Koo'], SWH: ['西灣河', 'Sai Wan Ho'], SKW: ['筲箕灣', 'Shau Kei Wan'],
  HFC: ['杏花邨', 'Heng Fa Chuen'], CHW: ['柴灣', 'Chai Wan'],
  TST: ['尖沙咀', 'Tsim Sha Tsui'], JOR: ['佐敦', 'Jordan'], YMT: ['油麻地', 'Yau Ma Tei'], MOK: ['旺角', 'Mong Kok'], PRE: ['太子', 'Prince Edward'],
  SSP: ['深水埗', 'Sham Shui Po'], CSW: ['長沙灣', 'Cheung Sha Wan'], LCK: ['荔枝角', 'Lai Chi Kok'], MEF: ['美孚', 'Mei Foo'], LAK: ['荔景', 'Lai King'],
  KWF: ['葵芳', 'Kwai Fong'], KWH: ['葵興', 'Kwai Hing'], TWH: ['大窩口', 'Tai Wo Hau'], TSW: ['荃灣', 'Tsuen Wan'],
  WHA: ['黃埔', 'Whampoa'], HOM: ['何文田', 'Ho Man Tin'], SKM: ['石硤尾', 'Shek Kip Mei'], KOT: ['九龍塘', 'Kowloon Tong'], LOF: ['樂富', 'Lok Fu'],
  WTS: ['黃大仙', 'Wong Tai Sin'], DIH: ['鑽石山', 'Diamond Hill'], CHH: ['彩虹', 'Choi Hung'], KOB: ['九龍灣', 'Kowloon Bay'], NTK: ['牛頭角', 'Ngau Tau Kok'],
  KWT: ['觀塘', 'Kwun Tong'], LAT: ['藍田', 'Lam Tin'], YAT: ['油塘', 'Yau Tong'], TIK: ['調景嶺', 'Tiu Keng Leng'],
  TKO: ['將軍澳', 'Tseung Kwan O'], HAH: ['坑口', 'Hang Hau'], POA: ['寶琳', 'Po Lam'], LHP: ['康城', 'LOHAS Park'],
  HOK: ['香港', 'Hong Kong'], KOW: ['九龍', 'Kowloon'], OLY: ['奧運', 'Olympic'], NAC: ['南昌', 'Nam Cheong'], TSY: ['青衣', 'Tsing Yi'],
  SUN: ['欣澳', 'Sunny Bay'], TUC: ['東涌', 'Tung Chung'], AIR: ['機場', 'Airport'], AWE: ['博覽館', 'AsiaWorld-Expo'], DIS: ['迪士尼', 'Disneyland Resort'],
  EXC: ['會展', 'Exhibition Centre'], HUH: ['紅磡', 'Hung Hom'], MKK: ['旺角東', 'Mong Kok East'], TAW: ['大圍', 'Tai Wai'], SHT: ['沙田', 'Sha Tin'],
  FOT: ['火炭', 'Fo Tan'], UNI: ['大學', 'University'], TAP: ['大埔墟', 'Tai Po Market'], TWO: ['太和', 'Tai Wo'], FAN: ['粉嶺', 'Fanling'],
  SHS: ['上水', 'Sheung Shui'], LOW: ['羅湖', 'Lo Wu'], LMC: ['落馬洲', 'Lok Ma Chau'],
  WKS: ['烏溪沙', 'Wu Kai Sha'], MOS: ['馬鞍山', 'Ma On Shan'], HEO: ['恆安', 'Heng On'], TSH: ['大水坑', 'Tai Shui Hang'], SHM: ['石門', 'Shek Mun'],
  CIO: ['第一城', 'City One'], STW: ['沙田圍', 'Sha Tin Wai'], CKT: ['車公廟', 'Che Kung Temple'], HIK: ['顯徑', 'Hin Keng'], KAT: ['啟德', 'Kai Tak'],
  SUW: ['宋皇臺', 'Sung Wong Toi'], TKW: ['土瓜灣', 'To Kwa Wan'], ETS: ['尖東', 'East Tsim Sha Tsui'], AUS: ['柯士甸', 'Austin'], TWW: ['荃灣西', 'Tsuen Wan West'],
  KSR: ['錦上路', 'Kam Sheung Road'], YUL: ['元朗', 'Yuen Long'], LOP: ['朗屏', 'Long Ping'], TIS: ['天水圍', 'Tin Shui Wai'], SIH: ['兆康', 'Siu Hong'], TUM: ['屯門', 'Tuen Mun'],
  OCP: ['海洋公園', 'Ocean Park'], WCH: ['黃竹坑', 'Wong Chuk Hang'], LET: ['利東', 'Lei Tung'], SOH: ['海怡半島', 'South Horizons'],
};

// [路綫, 車站序列, 每段行車分鐘（null = 每段 2 分鐘）]；行車時間為估算值
const SEGMENTS = [
  ['TML', 'WKS MOS HEO TSH SHM CIO STW CKT TAW HIK DIH KAT SUW TKW HOM HUH ETS AUS NAC MEF TWW KSR YUL LOP TIS SIH TUM', [2, 2, 2, 2, 2, 2, 2, 2, 3, 4, 3, 2, 2, 2, 2, 3, 2, 3, 4, 4, 9, 4, 2, 3, 3, 3]],
  ['KTL', 'WHA HOM YMT MOK PRE SKM KOT LOF WTS DIH CHH KOB NTK KWT LAT YAT TIK', [2, 3, 2, 2, 2, 2, 2, 2, 2, 2, 3, 2, 2, 2, 2, 2]],
  ['TWL', 'CEN ADM TST JOR YMT MOK PRE SSP CSW LCK MEF LAK KWF KWH TWH TSW', [2, 4, 2, 2, 2, 2, 2, 2, 2, 2, 3, 2, 2, 2, 2]],
  ['ISL', 'KET HKU SYP SHW CEN ADM WAC CAB TIH FOH NOP QUB TAK SWH SKW HFC CHW', null],
  ['EAL', 'ADM EXC HUH MKK KOT TAW SHT FOT UNI TAP TWO FAN SHS LOW', [2, 5, 4, 3, 5, 2, 3, 4, 6, 3, 6, 3, 6]],
  ['EAL', 'SHS LMC', [7]],
  ['TKL', 'NOP QUB YAT TIK TKO HAH POA', [3, 5, 2, 3, 2, 2]],
  ['TKL', 'TKO LHP', [4]],
  ['TCL', 'HOK KOW OLY NAC LAK TSY SUN TUC', [4, 2, 2, 3, 4, 6, 5]],
  ['SIL', 'ADM OCP WCH LET SOH', [4, 2, 2, 2]],
  ['DRL', 'SUN DIS', [4]],
  ['AEL', 'HOK KOW TSY AIR AWE', [3, 9, 12, 2]],
];
const WALKS = [['ETS', 'TST', 6], ['HOK', 'CEN', 7]]; // 站外步行轉乘
const CROSS = new Set(['ADM-TST', 'TST-ADM', 'EXC-HUH', 'HUH-EXC', 'QUB-YAT', 'YAT-QUB', 'HOK-KOW', 'KOW-HOK']); // 過海路段
const TRANSFER_MIN = 4;
// 全月通加強版（尖東 – 烏溪沙）覆蓋車站
const MPE_ZONE = new Set('ETS HUH HOM TKW SUW KAT DIH HIK TAW CKT STW CIO SHM TSH HEO MOS WKS'.split(' '));
const AEL_EST = { TSY: 70, KOW: 105, HOK: 115 }; // 機場快綫往機場估算車費（港元）

const STATION_LINES = {};
const LINE_STATIONS = {};
SEGMENTS.forEach(([line, str]) => {
  LINE_STATIONS[line] = LINE_STATIONS[line] || [];
  str.split(' ').forEach((c) => {
    if (!LINE_STATIONS[line].includes(c)) LINE_STATIONS[line].push(c);
    STATION_LINES[c] = STATION_LINES[c] || [];
    if (!STATION_LINES[c].includes(line)) STATION_LINES[c].push(line);
  });
});
Object.values(STATION_LINES).forEach((ls) => ls.sort((a, b) => LINE_ORDER.indexOf(a) - LINE_ORDER.indexOf(b)));
const ALL_STATIONS = [];
LINE_ORDER.forEach((l) => LINE_STATIONS[l].forEach((c) => { if (!ALL_STATIONS.includes(c)) ALL_STATIONS.push(c); }));

const GRAPH = (() => {
  const adj = {};
  const add = (a, b, e) => { (adj[a] = adj[a] || []).push({ to: b, ...e }); };
  SEGMENTS.forEach(([line, str, times], si) => {
    const cs = str.split(' ');
    for (let i = 0; i < cs.length - 1; i++) {
      const t = times ? times[i] : 2;
      const cross = CROSS.has(`${cs[i]}-${cs[i + 1]}`);
      add(`${cs[i]}|${line}`, `${cs[i + 1]}|${line}`, { cost: t, kind: 'ride', line, si, fwd: true, cross });
      add(`${cs[i + 1]}|${line}`, `${cs[i]}|${line}`, { cost: t, kind: 'ride', line, si, fwd: false, cross });
    }
  });
  Object.entries(STATION_LINES).forEach(([s, ls]) => ls.forEach((a) => ls.forEach((b) => {
    if (a !== b) add(`${s}|${a}`, `${s}|${b}`, { cost: TRANSFER_MIN, kind: 'xfer' });
  })));
  WALKS.forEach(([a, b, t]) => STATION_LINES[a].forEach((la) => STATION_LINES[b].forEach((lb) => {
    add(`${a}|${la}`, `${b}|${lb}`, { cost: t, kind: 'walk' });
    add(`${b}|${lb}`, `${a}|${la}`, { cost: t, kind: 'walk' });
  })));
  return adj;
})();

const stName = (code, lang) => (ST[code] ? (lang === 'zh' || lang === 'ja' ? ST[code][0] : ST[code][1]) : code);
const normName = (s) => String(s || '').toLowerCase().replace(/[^a-z]/g, '');

// Dijkstra：由啟德（屯馬綫）出發，計算最快路線
const ROUTE_CACHE = {};
function routeTo(dest) {
  if (ROUTE_CACHE[dest]) return ROUTE_CACHE[dest];
  const start = 'KAT|TML';
  const dist = { [start]: 0 }, prev = {}, done = new Set();
  let found = null;
  for (;;) {
    let u = null, best = Infinity;
    for (const k in dist) if (!done.has(k) && dist[k] < best) { best = dist[k]; u = k; }
    if (u === null) break;
    if (u.split('|')[0] === dest) { found = u; break; }
    done.add(u);
    for (const e of GRAPH[u] || []) {
      const nd = best + e.cost;
      if (nd < (dist[e.to] ?? Infinity)) { dist[e.to] = nd; prev[e.to] = { from: u, e }; }
    }
  }
  if (!found) return null;
  const edges = [];
  for (let k = found; prev[k]; k = prev[k].from) edges.unshift({ ...prev[k].e, a: prev[k].from.split('|')[0], b: k.split('|')[0] });
  const legs = [];
  let rideMins = 0, cross = false;
  for (const e of edges) {
    if (e.kind === 'xfer') continue;
    if (e.kind === 'walk') { legs.push({ kind: 'walk', line: 'WALK', from: e.a, to: e.b, mins: e.cost, stops: 0 }); continue; }
    rideMins += e.cost;
    if (e.cross) cross = true;
    const seg = SEGMENTS[e.si][1].split(' ');
    const toward = e.fwd ? seg[seg.length - 1] : seg[0];
    const last = legs[legs.length - 1];
    if (last && last.kind === 'ride' && last.line === e.line && last.to === e.a) {
      last.to = e.b; last.stops += 1; last.mins += e.cost;
      if (last.si !== e.si) { last.si = e.si; last.toward = toward; }
    } else {
      legs.push({ kind: 'ride', line: e.line, from: e.a, to: e.b, stops: 1, mins: e.cost, toward, si: e.si });
    }
  }
  const transfers = legs.slice(1).filter((l) => l.kind === 'ride').map((l) => l.from);
  const result = { legs, mins: Math.round(dist[found]), rideMins, cross, transfers };
  ROUTE_CACHE[dest] = result;
  return result;
}

function estimateFare(route) {
  const oct = Math.round((3.5 + 0.55 * Math.pow(route.rideMins, 0.85) + (route.cross ? 5 : 0)) * 10) / 10;
  return { oct, single: Math.ceil(oct * 1.1 * 2) / 2 };
}

// 由啟德往某站（不含機場快綫）的車費：優先使用港鐵開放數據
function fareTo(code, fares) {
  const f = fares && fares[normName(ST[code][1])];
  if (f && !Number.isNaN(f.oct)) return { oct: f.oct, single: f.single || f.oct, source: 'official' };
  const r = routeTo(code);
  return r ? { ...estimateFare(r), source: 'estimate' } : null;
}

function planTrip(dest, fares) {
  const route = routeTo(dest);
  if (!route) return null;
  const aelLeg = route.legs.find((l) => l.line === 'AEL');
  let fare;
  if (aelLeg) {
    const base = aelLeg.from === 'KAT' ? { oct: 0, single: 0, source: 'official' } : fareTo(aelLeg.from, fares);
    const extra = AEL_EST[aelLeg.from] || 100;
    fare = { oct: base.oct + extra, single: base.single + extra, source: base.source, ael: true };
  } else {
    fare = fareTo(dest, fares);
  }
  return { ...route, fare, pass: MPE_ZONE.has(dest) ? 'free' : 'disc' };
}

function parseFares(text) {
  const rows = String(text || '').replace(/^\uFEFF/, '').split(/\r?\n/).filter(Boolean);
  if (rows.length < 2) return null;
  const head = rows[0].split(',').map((h) => h.replace(/"/g, '').trim().toUpperCase());
  const iS = head.indexOf('SRC_STATION_NAME'), iD = head.indexOf('DEST_STATION_NAME');
  const iO = head.indexOf('OCT_ADT_FARE'), iSg = head.indexOf('SINGLE_ADT_FARE');
  if (iS < 0 || iD < 0 || iO < 0) return null;
  const out = {};
  for (let k = 1; k < rows.length; k++) {
    const c = rows[k].split(',').map((x) => x.replace(/"/g, '').trim());
    if (normName(c[iS]) !== 'kaitak') continue;
    out[normName(c[iD])] = { oct: parseFloat(c[iO]), single: iSg >= 0 ? parseFloat(c[iSg]) : null };
  }
  return Object.keys(out).length ? out : null;
}

const STATION_NAME = {
  WKS: { zh: '烏溪沙', en: 'Wu Kai Sha', ko: '우카이샤', ja: '烏溪沙' },
  TUM: { zh: '屯門', en: 'Tuen Mun', ko: '툰문', ja: '屯門' },
  TAW: { zh: '大圍', en: 'Tai Wai', ko: '타이와이', ja: '大圍' },
  HUH: { zh: '紅磡', en: 'Hung Hom', ko: '홍함', ja: '紅磡' },
};

/* ============================ 全域樣式（主題色 Token） ============================ */
const GLOBAL_CSS = `
:root{
  --bg:#EDF0F3; --surface:#FFFFFF; --surface-2:#F4F6F8; --ink:#16202B; --muted:#5A6573;
  --border:#D9DFE5; --tml:#9A3B26; --tml-soft:#F4E6E1; --sign:#FFCC00; --sign-ink:#111418;
  --ok:#0F7B4F; --warn-bg:#FFF4D6; --warn-ink:#7A4B00;
  font-family:'Noto Sans HK','Noto Sans TC','Noto Sans KR','Noto Sans JP',system-ui,-apple-system,'PingFang HK','Microsoft JhengHei',sans-serif;
}
@media (prefers-color-scheme: dark){
  :root:not([data-theme="light"]){
    --bg:#0E141A; --surface:#172029; --surface-2:#1E2933; --ink:#E7ECF1; --muted:#9AA6B2;
    --border:#2C3946; --tml:#D0745A; --tml-soft:#3A2520; --warn-bg:#3A2F12; --warn-ink:#FFD98A; --ok:#4FC28C;
  }
}
:root[data-theme="dark"]{
  --bg:#0E141A; --surface:#172029; --surface-2:#1E2933; --ink:#E7ECF1; --muted:#9AA6B2;
  --border:#2C3946; --tml:#D0745A; --tml-soft:#3A2520; --warn-bg:#3A2F12; --warn-ink:#FFD98A; --ok:#4FC28C;
}
body{ background:var(--bg); color:var(--ink); margin:0; }
.num{ font-family:'Barlow Semi Condensed','Noto Sans HK',sans-serif; font-feature-settings:'tnum'; }
:focus-visible{ outline:3px solid var(--sign); outline-offset:2px; border-radius:6px; }
.goog-te-gadget{ font-size:0 !important; } .goog-te-gadget .goog-te-combo{ font-size:13px; padding:4px 6px; border-radius:8px; border:1px solid var(--border); background:var(--surface); color:var(--ink); }
@media (prefers-reduced-motion: reduce){ *{ animation:none !important; transition:none !important; } }
`;

/* ============================ 共用小元件 ============================ */
function ExitPlate({ exit, size = 'md' }) {
  const big = size === 'lg';
  return (
    <div
      className={`num flex shrink-0 items-center justify-center rounded-md font-bold leading-none ${big ? 'h-14 min-w-[3.5rem] px-2 text-3xl' : 'h-7 min-w-[1.9rem] px-1.5 text-base'}`}
      style={{ background: 'var(--sign)', color: 'var(--sign-ink)', boxShadow: 'inset 0 -3px 0 rgba(0,0,0,.18)' }}
      aria-label={`Exit ${exit}`}
    >
      {exit}
    </div>
  );
}

function LineChip({ code, lang }) {
  const l = LINES[code];
  const label = tx(l.name, lang);
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold text-white" style={{ background: l.color }}>
      {code === 'WALK' ? <Footprints size={12} /> : <Train size={12} />}
      {label}
    </span>
  );
}

function Modal({ open, onClose, children, wide }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={onClose}>
          <motion.div role="dialog" aria-modal="true" onMouseDown={(e) => e.stopPropagation()}
            className={`max-h-[92vh] w-full overflow-y-auto rounded-t-2xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-2xl sm:rounded-2xl ${wide ? 'sm:max-w-2xl' : 'sm:max-w-sm'}`}
            initial={{ y: 40, opacity: 0, scale: 0.98 }} animate={{ y: 0, opacity: 1, scale: 1 }} exit={{ y: 30, opacity: 0 }}
            transition={{ type: 'spring', damping: 26, stiffness: 320 }}>
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/* ============================ Header ============================ */
function Header({ lang, setLang, t, isAdmin, onAdminClick, onLogout }) {
  const [gt, setGt] = useState('loading');
  useEffect(() => {
    // Google Translate Widget：全球語言一鍵翻譯
    window.googleTranslateElementInit = () => {
      try {
        new window.google.translate.TranslateElement(
          { pageLanguage: 'zh-TW', autoDisplay: false, layout: window.google.translate.TranslateElement.InlineLayout.SIMPLE },
          'google_translate_element'
        );
        setGt('ready');
      } catch { setGt('error'); }
    };
    if (!document.getElementById('gt-script')) {
      const s = document.createElement('script');
      s.id = 'gt-script';
      s.src = 'https://translate.google.com/translate_a/element.js?cb=googleTranslateElementInit';
      s.async = true;
      s.onerror = () => setGt('error');
      document.body.appendChild(s);
    }
    const timer = setTimeout(() => setGt((g) => (g === 'loading' ? 'error' : g)), 7000);
    return () => clearTimeout(timer);
  }, []);

  return (
    <header className="sticky top-0 z-30" style={{ top: 'env(safe-area-inset-top, 0px)' }}>
      <div className="bg-[#16202B] text-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg" style={{ background: LINES.TML.color }}>
              <Train size={22} />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-base font-bold leading-tight sm:text-lg">{t.title}</h1>
              <p className="text-xs text-white/60">Kai Tak Transit &amp; Landmark Guide</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex rounded-lg bg-white/10 p-0.5" role="group" aria-label="Language">
              {LANGS.map((l) => (
                <button key={l.code} onClick={() => setLang(l.code)}
                  className={`relative rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${lang === l.code ? 'text-[#16202B]' : 'text-white/75 hover:text-white'}`}>
                  {lang === l.code && <motion.span layoutId="langPill" className="absolute inset-0 rounded-md bg-white" transition={{ type: 'spring', damping: 30, stiffness: 400 }} />}
                  <span className="relative">{l.label}</span>
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1" title={gt === 'error' ? t.gtFail : 'Google Translate'}>
              <Globe size={16} className="text-white/60" />
              <div id="google_translate_element" className={gt === 'ready' ? '' : 'hidden'} />
              {gt !== 'ready' && <span className="hidden text-[11px] text-white/45 md:inline">{gt === 'error' ? 'Google' : '…'}</span>}
            </div>
            {isAdmin ? (
              <button onClick={onLogout} className="flex items-center gap-1 rounded-md bg-[var(--sign)] px-2 py-1 text-xs font-semibold text-[#111418]">
                <LogOut size={14} />{t.logout}
              </button>
            ) : (
              <button onClick={onAdminClick} aria-label={t.admin} title={t.admin} className="rounded-md p-1.5 text-white/35 transition-colors hover:bg-white/10 hover:text-white/80">
                <Lock size={15} />
              </button>
            )}
          </div>
        </div>
      </div>
      <div className="h-1.5" style={{ background: LINES.TML.color }} />
    </header>
  );
}

/* ============================ 站名看板（Hero） ============================ */
function StationBoard({ t, lang }) {
  return (
    <section className="mx-auto max-w-6xl px-4 pt-6">
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}
        className="relative overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)]">
        <div className="flex flex-wrap items-end justify-between gap-4 px-5 pb-4 pt-5 sm:px-7">
          <div>
            <div className="flex items-baseline gap-3">
              <span className="text-4xl font-black tracking-tight sm:text-5xl">{t.station}</span>
              <span className="text-xl font-medium text-[var(--muted)] sm:text-2xl">{t.stationAlt}</span>
            </div>
            <div className="mt-2 flex items-center gap-2 text-sm text-[var(--muted)]">
              <span className="num rounded border border-[var(--border)] px-1.5 py-0.5 text-xs font-bold text-[var(--ink)]">KAT</span>
              <span>{t.line}</span>
            </div>
          </div>
          <div className="flex items-center gap-1.5" aria-label="Exits">
            {['A', 'B1', 'B2', 'C', 'D'].map((e) => <ExitPlate key={e} exit={e} />)}
          </div>
        </div>
        {/* 屯馬綫路線條：鑽石山 ← 啟德 → 宋皇臺 */}
        <div className="relative border-t border-[var(--border)] bg-[var(--surface-2)] px-5 py-4 sm:px-7">
          <div className="relative flex items-center justify-between text-xs text-[var(--muted)]">
            <div className="absolute left-0 right-0 top-[9px] h-1.5 rounded-full" style={{ background: LINES.TML.color }} />
            {[{ zh: '鑽石山', en: 'Diamond Hill' }, { zh: '啟德', en: 'Kai Tak', me: true }, { zh: '宋皇臺', en: 'Sung Wong Toi' }].map((s) => (
              <div key={s.en} className="relative flex flex-col items-center gap-1.5">
                <div className={`rounded-full border-[3px] bg-[var(--surface)] ${s.me ? 'h-6 w-6 -mt-[3px]' : 'h-4 w-4 mt-[3px]'}`} style={{ borderColor: LINES.TML.color }} />
                <span className={s.me ? 'font-bold text-[var(--ink)]' : ''}>{lang === 'zh' || lang === 'ja' ? s.zh : s.en}</span>
              </div>
            ))}
          </div>
        </div>
      </motion.div>
    </section>
  );
}

/* ============================ 頁籤一：地標 ============================ */
function LandmarkCard({ item, lang, t, isAdmin, onEdit, onDelete }) {
  const cat = catById(item.category);
  return (
    <motion.article layout initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.2 }}
      className="relative flex flex-col rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
      {isAdmin && (
        <div className="absolute right-2 top-2 flex gap-1">
          <button onClick={() => onEdit(item)} className="flex items-center gap-1 rounded-md bg-[var(--surface-2)] px-2 py-1 text-xs font-medium hover:bg-[var(--border)]"><Pencil size={12} />{t.edit}</button>
          <button onClick={() => onDelete(item)} className="flex items-center gap-1 rounded-md bg-red-600 px-2 py-1 text-xs font-medium text-white hover:bg-red-700"><Trash2 size={12} />{t.del}</button>
        </div>
      )}
      <div className="flex items-start gap-3">
        <ExitPlate exit={item.exit} size="lg" />
        <div className={`min-w-0 flex-1 ${isAdmin ? 'pr-28 sm:pr-0 sm:pt-7' : ''}`}>
          <h3 className="text-base font-bold leading-snug">{tx(item.name, lang)}</h3>
          {lang !== 'zh' && item.name.zh !== tx(item.name, lang) && <p className="text-xs text-[var(--muted)]">{item.name.zh}</p>}
          <span className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-[var(--surface-2)] px-2 py-0.5 text-[11px] font-medium text-[var(--muted)]">
            <cat.Icon size={11} />{tx(cat.label, lang)}
          </span>
        </div>
      </div>
      <p className="mt-3 text-sm leading-relaxed text-[var(--ink)]/90">{tx(item.desc, lang)}</p>
      {tx(item.tip, lang) && (
        <div className="mt-3 flex gap-2 rounded-lg px-3 py-2 text-[13px] leading-relaxed" style={{ background: 'var(--tml-soft)' }}>
          <Footprints size={15} className="mt-0.5 shrink-0" style={{ color: 'var(--tml)' }} />
          <span><span className="sr-only">{t.tip}: </span>{tx(item.tip, lang)}</span>
        </div>
      )}
      <div className="mt-auto pt-3.5">
        <a href={mapsUrl(item.mapQuery || item.name.zh)} target="_blank" rel="noopener noreferrer"
          className="flex items-center justify-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-2 text-sm font-semibold transition-colors hover:border-[var(--ink)]">
          <Navigation size={15} />{t.navigate}
        </a>
      </div>
    </motion.article>
  );
}

function LandmarkPortal({ items, lang, t, isAdmin, onAdd, onEdit, onDelete }) {
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('all');

  const filtered = useMemo(() => {
    const k = q.trim().toLowerCase();
    return items.filter((it) => {
      if (cat !== 'all' && it.category !== cat) return false;
      if (!k) return true;
      const hay = [
        ...Object.values(it.name || {}), ...Object.values(it.desc || {}), ...Object.values(it.tip || {}),
        it.exit, `exit ${it.exit}`, `${it.exit} 出口`, it.mapQuery, ...Object.values(catById(it.category).label),
      ].join(' ').toLowerCase();
      // 單獨輸入出口代號（如 "c"、"b1"）時，精確比對出口
      if (/^(exit\s*)?[a-d]\d?$/i.test(k)) return it.exit.toLowerCase().split('/').includes(k.replace(/exit\s*/i, ''));
      return hay.includes(k);
    });
  }, [items, q, cat]);

  const counts = useMemo(() => {
    const c = { all: items.length };
    items.forEach((i) => { c[i.category] = (c[i.category] || 0) + 1; });
    return c;
  }, [items]);

  return (
    <div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <label className="relative flex-1">
          <Search size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t.searchPh}
            className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] py-3 pl-10 pr-10 text-[15px] outline-none focus:border-[var(--ink)]" />
          {q && <button onClick={() => setQ('')} aria-label="Clear" className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-[var(--muted)] hover:text-[var(--ink)]"><X size={16} /></button>}
        </label>
        {isAdmin && (
          <button onClick={onAdd} className="flex items-center justify-center gap-1.5 rounded-xl px-4 py-3 text-sm font-bold text-white" style={{ background: LINES.TML.color }}>
            <Plus size={17} />{t.addNew}
          </button>
        )}
      </div>

      <div className="-mx-4 mt-4 overflow-x-auto px-4 pb-1">
        <div className="flex w-max gap-2">
          {CATS.map((c) => {
            const active = cat === c.id;
            return (
              <button key={c.id} onClick={() => setCat(c.id)}
                className={`relative flex items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors ${active ? 'border-transparent text-white' : 'border-[var(--border)] bg-[var(--surface)] text-[var(--ink)] hover:border-[var(--ink)]'}`}>
                {active && <motion.span layoutId="catPill" className="absolute inset-0 rounded-full" style={{ background: 'var(--ink)' }} transition={{ type: 'spring', damping: 30, stiffness: 380 }} />}
                <span className={`relative flex items-center gap-1.5 ${active ? 'text-[var(--surface)]' : ''}`}>
                  {c.emoji ? <span aria-hidden>{c.emoji}</span> : <c.Icon size={14} />}
                  {tx(c.label, lang)}
                  <span className={`num text-xs ${active ? 'opacity-70' : 'text-[var(--muted)]'}`}>{counts[c.id] || 0}</span>
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <p className="mt-3 text-sm text-[var(--muted)]">{fmt(t.count, { n: filtered.length })}</p>

      {filtered.length === 0 ? (
        <div className="mt-6 rounded-xl border border-dashed border-[var(--border)] p-8 text-center">
          <p className="text-sm text-[var(--muted)]">{t.noResult}</p>
          <button onClick={() => { setQ(''); setCat('all'); }} className="mt-3 rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm font-medium hover:border-[var(--ink)]">{t.clear}</button>
        </div>
      ) : (
        <motion.div layout className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <AnimatePresence mode="popLayout">
            {filtered.map((it) => (
              <LandmarkCard key={it.id} item={it} lang={lang} t={t} isAdmin={isAdmin} onEdit={onEdit} onDelete={onDelete} />
            ))}
          </AnimatePresence>
        </motion.div>
      )}
    </div>
  );
}

/* ============================ 頁籤二：港鐵 ============================ */
// 模擬班次：以固定班距計算，無需狀態即可每秒倒數
function simTrains(now, headwayMin, offsetSec, dest) {
  const h = headwayMin * 60000, o = offsetSec * 1000;
  const first = Math.ceil((now - o) / h) * h + o;
  return [0, 1, 2, 3].map((k) => ({ dest, plat: dest === 'WKS' ? '1' : '2', at: first + k * h }));
}

function Arrivals({ t, lang }) {
  const [live, setLive] = useState(null); // {up, down, updated} | null
  const [status, setStatus] = useState('loading');
  const [now, setNow] = useState(Date.now());

  const load = useCallback(async () => {
    const j = await fetchFirst(MTR_SCHEDULE_URLS, (r) => r.json(), 5000);
    const s = j && j.data && j.data['TML-KAT'];
    if (!s) { setStatus('sim'); return; }
    const conv = (arr) => (arr || []).map((x) => ({ dest: x.dest, plat: x.plat, at: new Date(String(x.time).replace(' ', 'T') + '+08:00').getTime() }));
    setLive({ up: conv(s.UP), down: conv(s.DOWN), updated: Date.now() });
    setStatus('live');
  }, []);

  useEffect(() => { load(); const i = setInterval(load, 30000); return () => clearInterval(i); }, [load]);
  useEffect(() => { const i = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(i); }, []);

  const hour = new Date(now).getHours();
  const peak = (hour >= 7 && hour < 10) || (hour >= 17 && hour < 20);
  const hw = peak ? 3 : 5;
  const up = status === 'live' && live ? live.up.filter((x) => x.at > now - 20000).slice(0, 4) : simTrains(now, hw, 40, 'WKS');
  const down = status === 'live' && live ? live.down.filter((x) => x.at > now - 20000).slice(0, 4) : simTrains(now, hw, 150, 'TUM');

  const fmtLeft = (at) => {
    const d = Math.round((at - now) / 1000);
    if (d <= 30) return null;
    const m = Math.floor(d / 60), s = d % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  };

  const Col = ({ title, list }) => (
    <div className="rounded-xl bg-[#16202B] p-4 text-white">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-sm font-bold">{title}</span>
        <ArrowRight size={16} className="text-white/50" />
      </div>
      <ul className="space-y-2">
        {list.map((tr, i) => {
          const left = fmtLeft(tr.at);
          return (
            <li key={`${tr.at}-${i}`} className={`flex items-center justify-between gap-2 rounded-lg px-3 py-2 ${i === 0 ? 'bg-white/10' : ''}`}>
              <span className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: LINES.TML.color }} />
                <span className="text-sm">{tx(STATION_NAME[tr.dest] || { zh: tr.dest }, lang)}</span>
                <span className="text-[11px] text-white/50">{t.plat} {tr.plat}</span>
              </span>
              {left ? (
                <span className={`num tabular-nums ${i === 0 ? 'text-2xl font-bold text-[var(--sign)]' : 'text-lg text-white/80'}`}>{left}</span>
              ) : (
                <motion.span animate={{ opacity: [1, 0.35, 1] }} transition={{ repeat: Infinity, duration: 1.2 }} className="text-sm font-bold text-[var(--sign)]">{t.arriving}</motion.span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );

  return (
    <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-lg font-bold"><Clock size={19} />{t.arrivals}</h2>
        <div className="flex items-center gap-2 text-xs">
          <span className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 font-medium ${status === 'live' ? 'bg-emerald-100 text-emerald-800' : 'bg-[var(--warn-bg)] text-[var(--warn-ink)]'}`}>
            <span className={`h-2 w-2 rounded-full ${status === 'live' ? 'bg-emerald-500' : 'bg-amber-500'}`} />
            {status === 'loading' ? '…' : status === 'live' ? t.live : t.sim}
          </span>
          <button onClick={load} aria-label="Refresh" className="rounded-md p-1.5 text-[var(--muted)] hover:bg-[var(--surface-2)] hover:text-[var(--ink)]"><RefreshCw size={14} /></button>
        </div>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <Col title={t.toWKS} list={up} />
        <Col title={t.toTUM} list={down} />
      </div>
    </section>
  );
}


function StationDots({ code }) {
  return (
    <span className="flex gap-0.5">
      {(STATION_LINES[code] || []).map((l) => <span key={l} className="h-2 w-2 rounded-full" style={{ background: LINES[l].color }} />)}
    </span>
  );
}

function StationRouteFinder({ t, lang, fares, fareStatus }) {
  const [line, setLine] = useState('ALL');
  const [q, setQ] = useState('');
  const [dest, setDest] = useState('CEN');

  const list = useMemo(() => {
    const base = line === 'ALL' ? ALL_STATIONS : LINE_STATIONS[line];
    const k = q.trim().toLowerCase();
    if (!k) return base;
    return base.filter((c) => ST[c][0].includes(q.trim()) || ST[c][1].toLowerCase().includes(k) || c.toLowerCase() === k);
  }, [line, q]);

  const plan = useMemo(() => (dest === 'KAT' ? null : planTrip(dest, fares)), [dest, fares]);
  const fare = plan && plan.fare;

  return (
    <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-5">
      <h2 className="flex items-center gap-2 text-lg font-bold"><Wallet size={19} />{t.fareCalc}</h2>
      <p className="mt-1 text-sm text-[var(--muted)]">{t.stationPick}</p>

      <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,14rem)_1fr]">
        <label className="relative">
          <span className="sr-only">{t.allLines}</span>
          <select value={line} onChange={(e) => setLine(e.target.value)}
            className="w-full appearance-none rounded-lg border border-[var(--border)] bg-[var(--surface-2)] py-2.5 pl-3 pr-9 text-sm font-semibold outline-none focus:border-[var(--ink)]">
            <option value="ALL">{t.allLines}</option>
            {LINE_ORDER.map((l) => <option key={l} value={l}>{tx(LINES[l].name, lang)}</option>)}
          </select>
          <ChevronDown size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
        </label>
        <label className="relative">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t.stationSearch}
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-2)] py-2.5 pl-9 pr-9 text-sm outline-none focus:border-[var(--ink)]" />
          {q && <button onClick={() => setQ('')} aria-label="Clear" className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-[var(--muted)] hover:text-[var(--ink)]"><X size={15} /></button>}
        </label>
      </div>

      <div className="mt-2 flex items-center justify-between text-xs text-[var(--muted)]">
        <span>{fmt(t.stationCount, { n: list.length })}</span>
        {line !== 'ALL' && <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: LINES[line].color }} />{tx(LINES[line].name, lang)}</span>}
      </div>

      <div className="mt-2 max-h-56 overflow-y-auto rounded-xl border border-[var(--border)] p-2">
        {list.length === 0 ? (
          <p className="p-4 text-center text-sm text-[var(--muted)]">{t.noStation}</p>
        ) : (
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-4">
            {list.map((c) => {
              const active = dest === c;
              return (
                <button key={c} onClick={() => setDest(c)}
                  className={`flex items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors ${active ? 'text-white' : 'hover:bg-[var(--surface-2)]'}`}
                  style={active ? { background: LINES.TML.color } : undefined}>
                  <span className="min-w-0">
                    <span className="block truncate font-semibold">{stName(c, lang)}</span>
                    <span className={`block truncate text-[11px] ${active ? 'text-white/75' : 'text-[var(--muted)]'}`}>{lang === 'zh' || lang === 'ja' ? ST[c][1] : ST[c][0]}</span>
                  </span>
                  <StationDots code={c} />
                </button>
              );
            })}
          </div>
        )}
      </div>

      <AnimatePresence mode="wait">
        <motion.div key={dest} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.2 }} className="mt-5">
          {!plan ? (
            <p className="rounded-lg bg-[var(--surface-2)] p-4 text-sm">{t.atKat}</p>
          ) : (
            <div className="grid gap-5 md:grid-cols-[1.4fr_1fr]">
              <div>
                <h3 className="mb-1 text-sm font-semibold text-[var(--muted)]">{t.route}</h3>
                <p className="mb-3 flex items-center gap-1.5 text-sm font-medium">
                  <ArrowLeftRight size={14} className="text-[var(--muted)]" />
                  {plan.transfers.length === 0 ? t.transferNone : fmt(t.transferAt, { list: plan.transfers.map((c) => stName(c, lang)).join('、') })}
                </p>
                <ol>
                  <li className="flex items-center gap-3 pb-3">
                    <div className="h-6 w-6 rounded-full border-[3px] bg-[var(--surface)]" style={{ borderColor: LINES.TML.color }} />
                    <span className="text-sm font-bold">{stName('KAT', lang)}</span>
                  </li>
                  {plan.legs.map((lg, i) => (
                    <li key={i} className="relative flex pb-3 pl-3">
                      <div className="absolute bottom-0 left-3 top-0 w-1 -translate-x-1/2 rounded-full"
                        style={lg.kind === 'walk' ? { backgroundImage: `repeating-linear-gradient(${LINES.WALK.color} 0 4px, transparent 4px 8px)` } : { background: LINES[lg.line].color }} />
                      <div className="ml-6 flex flex-col gap-1 py-1">
                        <LineChip code={lg.line} lang={lang} />
                        <span className="text-sm">
                          {lg.kind === 'walk'
                            ? fmt(t.walkTo, { to: stName(lg.to, lang) })
                            : <>{fmt(t.dirTo, { to: stName(lg.toward, lang) })} <ArrowRight size={12} className="inline" /> <b>{stName(lg.to, lang)}</b></>}
                        </span>
                        <span className="text-xs text-[var(--muted)]">
                          {lg.kind === 'ride' && `${fmt(t.stops, { n: lg.stops })}, `}{lg.mins} {t.mins}
                        </span>
                      </div>
                    </li>
                  ))}
                  <li className="flex items-center gap-3">
                    <div className="h-6 w-6 rounded-full border-[3px] bg-[var(--surface)]" style={{ borderColor: LINES[plan.legs[plan.legs.length - 1].line].color }} />
                    <span className="text-sm font-bold">{stName(dest, lang)}</span>
                  </li>
                </ol>
              </div>

              <div className="flex flex-col gap-2">
                {[
                  { k: t.octopus, v: fare ? `$${fare.oct.toFixed(1)}` : '—', big: true },
                  { k: t.single, v: fare ? `$${fare.single.toFixed(1)}` : '—' },
                  { k: t.time, v: `${plan.mins} ${t.mins}`, sub: t.timeNote },
                ].map((r) => (
                  <div key={r.k} className="rounded-lg bg-[var(--surface-2)] px-4 py-3">
                    <div className="flex items-baseline justify-between">
                      <span className="text-sm text-[var(--muted)]">{r.k}</span>
                      <span className={`num font-bold ${r.big ? 'text-3xl' : 'text-xl'}`}>{r.v}</span>
                    </div>
                    {r.sub && <p className="mt-0.5 text-right text-[11px] text-[var(--muted)]">{r.sub}</p>}
                  </div>
                ))}
                <div className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold ${fare && fare.source === 'official' ? 'bg-emerald-100 text-emerald-800' : ''}`}
                  style={fare && fare.source === 'official' ? undefined : { background: 'var(--warn-bg)', color: 'var(--warn-ink)' }}>
                  <Database size={14} />
                  {fareStatus === 'loading' ? t.fareLoading : fare && fare.source === 'official' ? t.fareOfficial : t.fareEstimate}
                </div>
                {fare && fare.ael && <p className="text-xs text-[var(--warn-ink)]">{t.aelNote}</p>}
                <div className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold" style={{ background: 'var(--tml-soft)', color: 'var(--tml)' }}>
                  <Ticket size={14} />{plan.pass === 'free' ? t.passFree : t.passDisc}
                </div>
                <p className="text-xs text-[var(--muted)]">{t.fareNote}</p>
              </div>
            </div>
          )}
        </motion.div>
      </AnimatePresence>
    </section>
  );
}

const TICKETS = {
  zh: [
    { key: 'mp', title: '全月通 加強版（尖東 – 烏溪沙）', flag: '啟德站位處本全月通指定覆蓋範圍內！',
      body: ['有效月份內無限次免費乘搭屯馬綫尖東至烏溪沙段（包括啟德、鑽石山、紅磡等站）。', '連接指定範圍以外的路程（例如過海往金鐘、中環），正價車費可享 75 折（25% OFF）優惠。'] },
    { key: 'cs', title: '港鐵都會票（MTR City Saver）', warn: '客務中心不設發售，只可於啟德站「自動售票機」購買',
      body: ['40 天內可乘搭 40 程港鐵市區綫（包括啟德站）。', '適合經常跨區長途乘車的乘客。'] },
    { key: 'tdp', title: '遊客全日通（Tourist Day Pass）', warn: '啟德站現場不設發售',
      body: ['請預先於 MTR Mobile App／港鐵官網預訂，或前往設有指定客務中心的車站（如機場站、西九龍站、邊境車站）購買。', '購票後可於啟德站正常感應入閘使用。'] },
  ],
  en: [
    { key: 'mp', title: 'Monthly Pass Extra (East TST – Wu Kai Sha)', flag: "Kai Tak is inside this pass's coverage zone!",
      body: ['Unlimited free rides on the Tuen Ma Line between East Tsim Sha Tsui and Wu Kai Sha (incl. Kai Tak, Diamond Hill, Hung Hom) during the valid month.', 'Journeys beyond the zone (e.g. cross-harbour to Admiralty or Central) get 25% off the regular fare.'] },
    { key: 'cs', title: 'MTR City Saver', warn: 'Not sold at the Customer Service Centre. Buy it only from the ticket machines at Kai Tak.',
      body: ['40 rides on MTR urban lines (incl. Kai Tak) within 40 days.', 'Good for frequent long-distance riders.'] },
    { key: 'tdp', title: 'Tourist Day Pass', warn: 'Not sold at Kai Tak Station',
      body: ['Book in advance on the MTR Mobile app or website, or buy at a station with a designated Customer Service Centre (e.g. Airport, West Kowloon, boundary stations).', 'Once bought, tap in at Kai Tak as normal.'] },
  ],
  ko: [
    { key: 'mp', title: '월정액 패스 엑스트라 (이스트 침사추이 – 우카이샤)', flag: '카이탁역은 이 패스의 적용 구간에 포함됩니다!',
      body: ['유효 월 동안 툰마선 이스트 침사추이–우카이샤 구간(카이탁, 다이아몬드힐, 홍함 포함) 무제한 무료 탑승.', '구간 밖으로 이어지는 이동(예: 해저 터널 건너 애드미럴티·센트럴)은 정상 요금의 25% 할인.'] },
    { key: 'cs', title: 'MTR 시티 세이버 (MTR City Saver)', warn: '고객서비스센터에서는 판매하지 않으며, 카이탁역 자동발매기에서만 구매 가능',
      body: ['40일 이내 MTR 시내 노선(카이탁역 포함) 40회 탑승.', '장거리 이동이 잦은 승객에게 적합.'] },
    { key: 'tdp', title: '관광객 1일권 (Tourist Day Pass)', warn: '카이탁역에서는 판매하지 않습니다',
      body: ['MTR Mobile 앱·공식 웹사이트에서 미리 예약하거나, 지정 고객서비스센터가 있는 역(공항역, 웨스트카오룽역, 국경역 등)에서 구매하세요.', '구매 후 카이탁역에서 평소처럼 개찰구를 통과하면 됩니다.'] },
  ],
  ja: [
    { key: 'mp', title: '全月通 加強版（尖東 – 烏溪沙）', flag: '啓徳駅はこの定期券の対象区間内です！',
      body: ['有効月内は屯馬線 尖東–烏溪沙 区間（啓徳・鑽石山・紅磡など）が乗り放題。', '区間外へ続く乗車（例：海を渡って金鐘・中環へ）は通常運賃の25%割引。'] },
    { key: 'cs', title: 'MTR 都会票（MTR City Saver）', warn: 'カスタマーサービスセンターでは販売なし。啓徳駅の自動券売機でのみ購入可能',
      body: ['40日以内に MTR 市街地路線（啓徳駅を含む）を40回乗車可能。', '長距離移動の多い方におすすめ。'] },
    { key: 'tdp', title: '旅遊全日通（Tourist Day Pass）', warn: '啓徳駅では販売していません',
      body: ['MTR Mobile アプリ／公式サイトで事前予約するか、指定カスタマーサービスセンターのある駅（空港駅・西九龍駅・境界駅など）で購入してください。', '購入後は啓徳駅で通常通り改札を通過できます。'] },
  ],
};

function TicketZone({ t, lang }) {
  const list = TICKETS[lang] || TICKETS.en;
  return (
    <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-5">
      <h2 className="flex items-center gap-2 text-lg font-bold"><Ticket size={19} />{t.tickets}</h2>
      <div className="mt-4 grid gap-3 lg:grid-cols-3">
        {list.map((tk) => (
          <article key={tk.key} className={`flex flex-col rounded-xl border p-4 ${tk.flag ? 'border-2' : 'border-[var(--border)]'}`} style={tk.flag ? { borderColor: LINES.TML.color } : undefined}>
            <h3 className="font-bold leading-snug">{tk.title}</h3>
            {tk.flag && (
              <div className="mt-2 flex items-start gap-2 rounded-lg px-3 py-2 text-sm font-bold text-white" style={{ background: LINES.TML.color }}>
                <CheckCircle2 size={17} className="mt-0.5 shrink-0" />{tk.flag}
              </div>
            )}
            {tk.warn && (
              <div className="mt-2 flex items-start gap-2 rounded-lg px-3 py-2 text-sm font-bold" style={{ background: 'var(--warn-bg)', color: 'var(--warn-ink)' }}>
                <AlertTriangle size={17} className="mt-0.5 shrink-0" />{tk.warn}
              </div>
            )}
            <ul className="mt-3 space-y-2 text-sm leading-relaxed">
              {tk.body.map((b, i) => <li key={i} className="flex gap-2"><span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--muted)]" />{b}</li>)}
            </ul>
          </article>
        ))}
      </div>

      <div className="mt-4 grid gap-3 rounded-xl bg-[var(--surface-2)] p-4 sm:grid-cols-[1fr_auto] sm:items-center">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-bold"><Info size={16} />{t.service}</h3>
          <ul className="mt-2 space-y-2 text-sm">
            <li className="flex items-start gap-2"><Info size={16} className="mt-0.5 shrink-0 text-[var(--muted)]" /><span>{t.csc}</span></li>
            <li className="flex items-start gap-2"><Ticket size={16} className="mt-0.5 shrink-0 text-[var(--muted)]" /><span>{t.tvm}</span></li>
          </ul>
        </div>
        <a href={TICKET_URL} target="_blank" rel="noopener noreferrer"
          className="flex items-center justify-center gap-2 rounded-lg px-4 py-3 text-sm font-bold text-white" style={{ background: '#16202B' }}>
          🔗 {t.officialLink}<ExternalLink size={15} />
        </a>
      </div>
    </section>
  );
}

let FARE_CACHE = null;
function MTRGuide({ t, lang }) {
  const [fares, setFares] = useState(FARE_CACHE);
  const [fareStatus, setFareStatus] = useState(FARE_CACHE ? 'official' : 'loading');
  useEffect(() => {
    if (FARE_CACHE) return;
    let alive = true;
    fetchFirst(MTR_FARE_URLS, async (r) => parseFares(await r.text()), 10000).then((f) => {
      if (!alive) return;
      FARE_CACHE = f;
      setFares(f);
      setFareStatus(f ? 'official' : 'estimate');
    });
    return () => { alive = false; };
  }, []);
  return (
    <div className="space-y-4">
      <Arrivals t={t} lang={lang} />
      <StationRouteFinder t={t} lang={lang} fares={fares} fareStatus={fareStatus} />
      <TicketZone t={t} lang={lang} />
    </div>
  );
}

/* ============================ 管理員 Modal ============================ */
function LoginModal({ open, onClose, onSuccess, t }) {
  const [email, setEmail] = useState(ADMIN_EMAIL);
  const [pw, setPw] = useState('');
  const [err, setErr] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setPw(''); setErr(false); setBusy(false); } }, [open]);

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    let ok = false;
    if (supabase) {
      try {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password: pw });
        ok = !error;
      } catch { ok = false; }
    } else {
      ok = pw === ADMIN_PASSWORD;
    }
    setBusy(false);
    if (ok) { onSuccess(); onClose(); } else setErr(true);
  };
  const inputCls = 'w-full rounded-lg border bg-[var(--surface-2)] px-3 py-2.5 outline-none';

  return (
    <Modal open={open} onClose={onClose}>
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-lg font-bold"><Lock size={18} />{t.admin}</h2>
        <button onClick={onClose} aria-label="Close" className="rounded p-1 text-[var(--muted)] hover:text-[var(--ink)]"><X size={18} /></button>
      </div>
      <motion.div animate={err ? { x: [0, -8, 8, -5, 5, 0] } : {}} transition={{ duration: 0.35 }} className="mt-4 space-y-2">
        {supabase && !ADMIN_EMAIL && (
          <input type="email" value={email} onChange={(e) => { setEmail(e.target.value); setErr(false); }} placeholder={t.email}
            className={`${inputCls} border-[var(--border)] focus:border-[var(--ink)]`} />
        )}
        <input type="password" autoFocus value={pw} onChange={(e) => { setPw(e.target.value); setErr(false); }}
          onKeyDown={(e) => e.key === 'Enter' && submit()} placeholder={t.pwPh}
          className={`${inputCls} ${err ? 'border-red-500' : 'border-[var(--border)] focus:border-[var(--ink)]'}`} />
      </motion.div>
      {err && <p className="mt-2 text-sm text-red-600">{t.pwWrong}</p>}
      <button onClick={submit} disabled={busy} className="mt-4 w-full rounded-lg py-2.5 font-bold text-white disabled:opacity-60" style={{ background: LINES.TML.color }}>
        {busy ? t.signingIn : t.login}
      </button>
    </Modal>
  );
}

const emptyForm = () => ({
  id: null, category: 'shopping', exit: 'A', mapQuery: '',
  name: { zh: '', en: '', ko: '', ja: '' }, desc: { zh: '', en: '', ko: '', ja: '' }, tip: { zh: '', en: '', ko: '', ja: '' },
});

function LandmarkForm({ open, onClose, initial, onSave, t, lang }) {
  const [f, setF] = useState(emptyForm());
  const [tab, setTab] = useState('zh');
  const [err, setErr] = useState('');
  useEffect(() => {
    if (open) {
      const base = emptyForm();
      setF(initial ? { ...base, ...initial, name: { ...base.name, ...initial.name }, desc: { ...base.desc, ...initial.desc }, tip: { ...base.tip, ...initial.tip } } : base);
      setTab('zh'); setErr('');
    }
  }, [open, initial]);

  const setL = (field, v) => setF((p) => ({ ...p, [field]: { ...p[field], [tab]: v } }));
  const submit = () => {
    if (!f.name.zh.trim() || !f.exit.trim()) { setErr(t.required); return; }
    onSave({ ...f, id: f.id || `lm-${Date.now()}`, mapQuery: f.mapQuery.trim() || f.name.zh.trim() });
  };
  const inputCls = 'w-full rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-sm outline-none focus:border-[var(--ink)]';

  return (
    <Modal open={open} onClose={onClose} wide>
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold">{initial ? t.formEdit : t.formAdd}</h2>
        <button onClick={onClose} aria-label="Close" className="rounded p-1 text-[var(--muted)] hover:text-[var(--ink)]"><X size={18} /></button>
      </div>

      <div className="mt-4 flex gap-1 rounded-lg bg-[var(--surface-2)] p-1">
        {LANGS.map((l) => (
          <button key={l.code} onClick={() => setTab(l.code)}
            className={`flex-1 rounded-md py-1.5 text-xs font-semibold ${tab === l.code ? 'bg-[var(--surface)] shadow-sm' : 'text-[var(--muted)]'}`}>
            {l.label}{l.code === 'zh' && ' *'}
          </button>
        ))}
      </div>

      <div className="mt-3 space-y-3">
        <label className="block text-sm font-medium">{t.fName}
          <input className={`${inputCls} mt-1`} value={f.name[tab]} onChange={(e) => setL('name', e.target.value)} />
        </label>
        <label className="block text-sm font-medium">{t.fDesc}
          <textarea rows={2} className={`${inputCls} mt-1`} value={f.desc[tab]} onChange={(e) => setL('desc', e.target.value)} />
        </label>
        <label className="block text-sm font-medium">{t.fTip}
          <textarea rows={2} className={`${inputCls} mt-1`} value={f.tip[tab]} onChange={(e) => setL('tip', e.target.value)} />
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm font-medium">{t.fCat}
            <select className={`${inputCls} mt-1`} value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>
              {CATS.filter((c) => c.id !== 'all').map((c) => <option key={c.id} value={c.id}>{c.emoji} {tx(c.label, lang)}</option>)}
            </select>
          </label>
          <label className="block text-sm font-medium">{t.fExit} *
            <div className="mt-1 flex flex-wrap gap-1.5">
              {EXITS.map((e) => (
                <button type="button" key={e} onClick={() => setF({ ...f, exit: e })}
                  className={`num rounded-md px-2.5 py-1.5 text-sm font-bold ${f.exit === e ? 'bg-[var(--sign)] text-[#111418]' : 'border border-[var(--border)] text-[var(--muted)]'}`}>{e}</button>
              ))}
            </div>
          </label>
        </div>
        <label className="block text-sm font-medium">{t.fQuery}
          <input className={`${inputCls} mt-1`} value={f.mapQuery} placeholder="例如：AIRSIDE 啟德" onChange={(e) => setF({ ...f, mapQuery: e.target.value })} />
        </label>
      </div>

      {err && <p className="mt-3 text-sm text-red-600">{err}</p>}
      <div className="mt-5 flex justify-end gap-2">
        <button onClick={onClose} className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm font-medium">{t.cancel}</button>
        <button onClick={submit} className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-bold text-white" style={{ background: LINES.TML.color }}><Database size={15} />{t.save}</button>
      </div>
    </Modal>
  );
}

function ConfirmModal({ request, onClose, t }) {
  return (
    <Modal open={!!request} onClose={onClose}>
      {request && (
        <>
          <div className="flex items-start gap-3">
            <div className="rounded-full bg-red-100 p-2 text-red-600"><AlertTriangle size={18} /></div>
            <p className="text-sm leading-relaxed">{request.message}</p>
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <button onClick={onClose} className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm font-medium">{t.cancel}</button>
            <button onClick={request.action} className="rounded-lg bg-red-600 px-4 py-2 text-sm font-bold text-white">{request.label}</button>
          </div>
        </>
      )}
    </Modal>
  );
}

/* ============================ App ============================ */
function App() {
  const [lang, setLang] = useState('zh');
  const [tab, setTab] = useState('land');
  const [items, setItems] = useState(SEED);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [confirmReq, setConfirmReq] = useState(null);
  const [toast, setToast] = useState('');
  const t = UI[lang];

  useEffect(() => { db.list().then((d) => { if (d && d.length) setItems(d); }).catch(() => {}); }, []);
  useEffect(() => { document.documentElement.lang = { zh: 'zh-HK', en: 'en', ko: 'ko', ja: 'ja' }[lang]; }, [lang]);
  useEffect(() => { if (!toast) return; const i = setTimeout(() => setToast(''), 2200); return () => clearTimeout(i); }, [toast]);

  const handleSave = async (item) => {
    const exists = items.some((x) => x.id === item.id);
    const next = exists ? items.map((x) => (x.id === item.id ? item : x)) : [item, ...items];
    setItems(next);
    setFormOpen(false);
    try { await db.upsert(item, next); setToast(t.saved); } catch (e) { setToast(String(e.message || e)); }
  };
  const handleDelete = async (item) => {
    const next = items.filter((x) => x.id !== item.id);
    setItems(next);
    setConfirmReq(null);
    try { await db.remove(item.id, next); setToast(t.deleted); } catch (e) { setToast(String(e.message || e)); }
  };
  const handleSync = async () => {
    setConfirmReq(null);
    try { await db.replaceAll(SEED); setItems(SEED); setToast(t.synced); } catch (e) { setToast(String(e.message || e)); }
  };
  const askDelete = (item) => setConfirmReq({ message: fmt(t.confirmDel, { name: tx(item.name, lang) }), label: t.del, action: () => handleDelete(item) });
  const askSync = () => setConfirmReq({ message: fmt(t.syncConfirm, { n: SEED.length }), label: t.sync, action: handleSync });
  const handleLoginSuccess = async () => {
    setIsAdmin(true);
    try { if (await db.seedIfEmpty(SEED)) { setItems(SEED); setToast(t.seeded); } } catch (e) { setToast(String(e.message || e)); }
  };
  const handleLogout = () => { if (supabase) supabase.auth.signOut(); setIsAdmin(false); };

  const TABS = [
    { id: 'land', label: t.tabLand, Icon: MapPin },
    { id: 'mtr', label: t.tabMtr, Icon: Train },
  ];

  return (
    <div className="min-h-full bg-[var(--bg)] text-[var(--ink)]">
      <style>{GLOBAL_CSS}</style>
      <Header lang={lang} setLang={setLang} t={t} isAdmin={isAdmin} onAdminClick={() => setLoginOpen(true)} onLogout={handleLogout} />

      <AnimatePresence>
        {isAdmin && (
          <motion.div initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }} className="overflow-hidden bg-[var(--sign)] text-[#111418]">
            <div className="mx-auto flex max-w-6xl items-center justify-between gap-2 px-4 py-2 text-sm font-semibold">
              <span className="flex items-center gap-2"><Unlock size={15} />{t.adminOn}</span>
              <span className="flex flex-wrap items-center justify-end gap-3">
                <span className="flex items-center gap-1.5 text-xs font-medium"><Database size={13} />{db.mode === 'cloud' ? t.storeCloud : t.storeLocal}</span>
                <button onClick={askSync} className="flex items-center gap-1.5 rounded-md bg-[#111418] px-2.5 py-1 text-xs font-bold text-[var(--sign)]">
                  <RefreshCw size={13} />{t.sync}
                </button>
              </span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <StationBoard t={t} lang={lang} />

      <main className="mx-auto max-w-6xl px-4 pb-16 pt-5">
        <nav className="mb-5 flex gap-1 border-b border-[var(--border)]" role="tablist">
          {TABS.map((tb) => (
            <button key={tb.id} role="tab" aria-selected={tab === tb.id} onClick={() => setTab(tb.id)}
              className={`relative flex items-center gap-2 px-3 pb-3 pt-1 text-[15px] font-bold transition-colors sm:px-4 ${tab === tb.id ? 'text-[var(--ink)]' : 'text-[var(--muted)] hover:text-[var(--ink)]'}`}>
              <tb.Icon size={17} />{tb.label}
              {tab === tb.id && <motion.span layoutId="tabLine" className="absolute -bottom-px left-0 right-0 h-[3px] rounded-full" style={{ background: LINES.TML.color }} />}
            </button>
          ))}
        </nav>

        <AnimatePresence mode="wait">
          <motion.div key={tab} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.18 }}>
            {tab === 'land' ? (
              <LandmarkPortal items={items} lang={lang} t={t} isAdmin={isAdmin}
                onAdd={() => { setEditing(null); setFormOpen(true); }}
                onEdit={(it) => { setEditing(it); setFormOpen(true); }}
                onDelete={askDelete} />
            ) : (
              <MTRGuide t={t} lang={lang} />
            )}
          </motion.div>
        </AnimatePresence>
      </main>

      <footer className="border-t border-[var(--border)] py-6 text-center text-xs text-[var(--muted)]">
        Kai Tak Transit &amp; Landmark Guide（原型 Prototype）
      </footer>

      <LoginModal open={loginOpen} onClose={() => setLoginOpen(false)} onSuccess={handleLoginSuccess} t={t} />
      <LandmarkForm open={formOpen} onClose={() => setFormOpen(false)} initial={editing} onSave={handleSave} t={t} lang={lang} />
      <ConfirmModal request={confirmReq} onClose={() => setConfirmReq(null)} t={t} />

      <AnimatePresence>
        {toast && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 20 }}
            className="fixed bottom-6 left-1/2 z-[60] flex -translate-x-1/2 items-center gap-2 rounded-full bg-[#16202B] px-4 py-2.5 text-sm font-medium text-white shadow-lg"
            style={{ marginBottom: 'env(safe-area-inset-bottom, 0px)' }}>
            <CheckCircle2 size={16} className="text-[var(--sign)]" />{toast}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default App;
