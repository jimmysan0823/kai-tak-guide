/**
 * 啟德站周邊地標與交通轉乘指南 (Kai Tak Transit & Landmark Guide)  v9.4（轉乘巴士／小巴卡片：實時到站班次倒數）
 * React + Tailwind CSS + lucide-react + framer-motion + Supabase
 * 依賴：npm i framer-motion lucide-react @supabase/supabase-js
 */
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { createClient } from '@supabase/supabase-js';
import { AlertTriangle, ArrowLeftRight, ArrowRight, Banknote, UtensilsCrossed, Bus, CheckCircle2, ChevronDown, Clock, Database, ExternalLink, Factory, Footprints, Globe, GraduationCap, HeartPulse, Home, Info, Landmark, LayoutGrid, Lock, LogOut, MapPin, Navigation, Pencil, Plus, RefreshCw, Search, Ship, ShoppingBag, Ticket, Train, Trash2, Unlock, Wallet, X } from 'lucide-react';

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
// 餐廳等額外資料（meta）存放於 tip 欄位內的 _meta，毋須修改 Supabase 資料表結構
const toRow = (x, i) => ({ id: x.id, category: x.category, exit: x.exit, name: x.name, desc: x.desc, tip: x.meta ? { ...(x.tip || {}), _meta: x.meta } : x.tip, map_query: x.mapQuery, sort: i });
const fromRow = (r) => {
  const { _meta, ...tip } = r.tip || {};
  return { id: r.id, category: r.category, exit: r.exit, name: r.name, desc: r.desc, tip, mapQuery: r.map_query, ...(_meta ? { meta: _meta } : {}) };
};

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
const TICKET_URL = 'https://www.mtr.com.hk/ch/customer/tickets/index.php';
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
const UI_FARES = {
  zh: { fareType: '乘客類別', octCol: '八達通', singleCol: '單程票', fAdult: '成人', fChild: '小童（3–11 歲）', fElder: '長者（65 歲或以上）', fJoy60: '樂悠咭（60–64 歲）', fJoy65: '樂悠咭（65 歲或以上）',
    joyNote: '樂悠咭「兩蚊兩折」（2026 年 4 月 3 日起）：成人車費 $10 或以下付 $2；高於 $10 付成人車費兩成。樂悠咭只以八達通形式使用，不設單程票。',
    joy65Note: '樂悠咭（65 歲或以上）按「兩蚊兩折」與長者優惠車費兩者較低者推算，實際收費以入閘扣數為準。',
    aelConcession: '機場快綫車程的優惠車費請參閱港鐵官網。' },
  en: { fareType: 'Passenger', octCol: 'Octopus', singleCol: 'Single', fAdult: 'Adult', fChild: 'Child (3–11)', fElder: 'Elderly (65+)', fJoy60: 'JoyYou Card (60–64)', fJoy65: 'JoyYou Card (65+)',
    joyNote: 'JoyYou "$2 or 20%" scheme (from 3 April 2026): pay $2 if the adult fare is $10 or less, otherwise 20% of the adult fare. JoyYou is an Octopus card, so no single journey ticket applies.',
    joy65Note: 'JoyYou (65+) is inferred as the lower of the "$2 or 20%" fare and the elderly concessionary fare. The amount deducted at the gate is final.',
    aelConcession: 'See the MTR website for concessionary Airport Express fares.' },
  ko: { fareType: '승객 유형', octCol: '옥토퍼스', singleCol: '편도 승차권', fAdult: '성인', fChild: '어린이 (3–11세)', fElder: '경로 (65세 이상)', fJoy60: '조이유 카드 (60–64세)', fJoy65: '조이유 카드 (65세 이상)',
    joyNote: '조이유 카드 "2달러·20%" 제도(2026년 4월 3일부터): 성인 요금이 10달러 이하이면 2달러, 초과하면 성인 요금의 20%. 조이유 카드는 옥토퍼스 방식으로만 사용하며 편도 승차권은 없습니다.',
    joy65Note: '조이유 카드(65세 이상)는 "2달러·20%" 요금과 경로 우대 요금 중 낮은 금액으로 추정한 값이며, 실제 요금은 개찰구 차감액을 기준으로 합니다.',
    aelConcession: '공항철도 우대 요금은 MTR 웹사이트를 참고하세요.' },
  ja: { fareType: '乗客区分', octCol: 'オクトパス', singleCol: '片道きっぷ', fAdult: '大人', fChild: '子供（3–11歳）', fElder: '高齢者（65歳以上）', fJoy60: 'JoyYou カード（60–64歳）', fJoy65: 'JoyYou カード（65歳以上）',
    joyNote: 'JoyYou カード「2ドル・2割」制度（2026年4月3日から）：大人運賃が10ドル以下なら2ドル、10ドル超は大人運賃の2割。JoyYou はオクトパス形式のみで、片道きっぷはありません。',
    joy65Note: 'JoyYou（65歳以上）は「2ドル・2割」運賃と高齢者割引運賃の低い方として推定した値です。実際の運賃は改札での引き落とし額が優先されます。',
    aelConcession: 'エアポート・エクスプレスの割引運賃は MTR 公式サイトをご確認ください。' },
};
Object.keys(UI_FARES).forEach((l) => Object.assign(UI[l], UI_FARES[l]));
const money = (v) => (v == null ? '—' : `$${v.toFixed(1)}`);
const UI_V6 = {
  zh: {
    tabBus: '巴士實時到站', busTitle: '啟德站附近巴士實時到站', busKey: '主要接駁路線', busAll: '全部路線', busLoading: '正在載入巴士資料…',
    busLive: '九巴／城巴開放數據', busOfflineShort: '未能連線', busOffline: '暫時未能連接巴士開放數據。部署到你的網站後即可顯示實時班次，下面先列出港鐵官方指南的接駁路線。',
    busNone: '附近車站暫時沒有符合的路線資料。', busNoEta: '暫無班次', busArriving: '即將抵達', busMin: '{n} 分鐘', busTo: '往 {dest}', busDist: '約 {m} 米',
    busNew: '新路線', busKmb: '九巴', busCtb: '城巴', busLeaflet: '港鐵官方指南：接駁路線及上車出口',
    busSource: '資料來源：九巴及城巴實時到站開放數據（DATA.GOV.HK），每 30 秒更新；系統會自動搜尋啟德站約 650 米範圍內的巴士站，新開辦的路線及巴士站會自動出現。專線小巴暫未納入。',
    syncBanner: '官方指南資料有 {n} 項更新', syncReview: '檢視並同步', syncAdded: '新增', syncChanged: '修改', syncRemoved: '移除',
    syncApply: '確認同步', syncNote: '你在後台自行新增的地點會保留；曾被修改過的官方地點會還原為最新官方資料。', syncNothing: '雲端資料已是最新版本。',
    liveUpdated: '地標資料已自動更新', dataVersion: '資料版本：{v}',
  },
  en: {
    tabBus: 'Live bus ETA', busTitle: 'Live bus arrivals near Kai Tak Station', busKey: 'Main feeder routes', busAll: 'All routes', busLoading: 'Loading bus data…',
    busLive: 'KMB / Citybus Open Data', busOfflineShort: 'Offline', busOffline: 'Bus open data is unavailable right now. Live ETAs appear once deployed on your site. The feeder routes from the MTR leaflet are listed below.',
    busNone: 'No matching routes at nearby stops right now.', busNoEta: 'No service', busArriving: 'Arriving', busMin: '{n} min', busTo: 'To {dest}', busDist: '~{m} m',
    busNew: 'New', busKmb: 'KMB', busCtb: 'Citybus', busLeaflet: 'MTR leaflet: feeder routes and boarding exits',
    busSource: 'Source: KMB and Citybus real-time ETA open data (DATA.GOV.HK), refreshed every 30 seconds. Stops within about 650 m of Kai Tak Station are found automatically, so new routes and stops appear on their own. Green minibuses are not included yet.',
    syncBanner: '{n} updates from the official leaflet', syncReview: 'Review and sync', syncAdded: 'Added', syncChanged: 'Changed', syncRemoved: 'Removed',
    syncApply: 'Sync now', syncNote: 'Places you added yourself are kept. Official places you edited are restored to the latest official data.', syncNothing: 'Cloud data is already up to date.',
    liveUpdated: 'Landmark data updated automatically', dataVersion: 'Data version: {v}',
  },
  ko: {
    tabBus: '버스 실시간 도착', busTitle: '카이탁역 주변 버스 실시간 도착', busKey: '주요 연계 노선', busAll: '전체 노선', busLoading: '버스 정보 불러오는 중…',
    busLive: 'KMB / 시티버스 오픈 데이터', busOfflineShort: '연결 불가', busOffline: '지금은 버스 오픈 데이터에 연결할 수 없습니다. 사이트에 배포하면 실시간 도착 정보가 표시됩니다. 아래는 MTR 공식 안내의 연계 노선입니다.',
    busNone: '주변 정류장에 해당 노선 정보가 없습니다.', busNoEta: '운행 없음', busArriving: '곧 도착', busMin: '{n}분', busTo: '{dest} 방면', busDist: '약 {m}m',
    busNew: '신규', busKmb: 'KMB', busCtb: '시티버스', busLeaflet: 'MTR 공식 안내: 연계 노선 및 승차 출구',
    busSource: '출처: KMB·시티버스 실시간 도착 오픈 데이터(DATA.GOV.HK), 30초마다 갱신. 카이탁역 반경 약 650m 정류장을 자동 검색하므로 신규 노선·정류장이 자동으로 표시됩니다. 미니버스는 아직 포함되지 않습니다.',
    syncBanner: '공식 안내 데이터 업데이트 {n}건', syncReview: '확인 후 동기화', syncAdded: '추가', syncChanged: '변경', syncRemoved: '삭제',
    syncApply: '동기화', syncNote: '직접 추가한 장소는 유지되며, 수정한 공식 장소는 최신 공식 데이터로 복원됩니다.', syncNothing: '클라우드 데이터가 최신입니다.',
    liveUpdated: '명소 데이터가 자동 업데이트되었습니다', dataVersion: '데이터 버전: {v}',
  },
  ja: {
    tabBus: 'バス リアルタイム', busTitle: '啓徳駅周辺のバス リアルタイム到着', busKey: '主な連絡路線', busAll: '全路線', busLoading: 'バス情報を読み込み中…',
    busLive: 'KMB／シティバス オープンデータ', busOfflineShort: '接続不可', busOffline: '現在バスのオープンデータに接続できません。ご自身のサイトにデプロイするとリアルタイム到着情報が表示されます。下記は MTR 公式案内の連絡路線です。',
    busNone: '周辺の停留所に該当する路線情報がありません。', busNoEta: '運行なし', busArriving: 'まもなく到着', busMin: '{n} 分', busTo: '{dest} 行き', busDist: '約 {m} m',
    busNew: '新路線', busKmb: 'KMB', busCtb: 'シティバス', busLeaflet: 'MTR 公式案内：連絡路線と乗車出口',
    busSource: '出典：KMB・シティバスのリアルタイム到着オープンデータ（DATA.GOV.HK）、30秒ごとに更新。啓徳駅から約650m以内の停留所を自動検索するため、新路線・新停留所も自動で表示されます。ミニバスは未対応です。',
    syncBanner: '公式案内データの更新 {n} 件', syncReview: '確認して同期', syncAdded: '追加', syncChanged: '変更', syncRemoved: '削除',
    syncApply: '同期する', syncNote: '自分で追加した場所は保持され、編集した公式の場所は最新の公式データに戻ります。', syncNothing: 'クラウドのデータは最新です。',
    liveUpdated: 'ランドマーク情報が自動更新されました', dataVersion: 'データ版：{v}',
  },
};
Object.keys(UI_V6).forEach((l) => Object.assign(UI[l], UI_V6[l]));
const UI_V7 = {
  zh: {
    octBanner: '啟德站現場不設實體八達通卡（Physical Octopus Card）發售。如需購買，請前往設有完整客務中心櫃枱的車站（如鑽石山站或何文田站），或使用手機八達通（Mobile Octopus）。',
    tvmTitle: '啟德站自動售票機', tvmFuncLabel: '可辦理服務', tvmFuncs: ['八達通增值', '查詢餘額', '購買全月通', '購買單程票', '購買都會票'],
    tvmPayLabel: '付款方式', tvmPayOk: '只接受八達通或港幣現金', tvmPayNo: '不接受信用卡、微信支付或支付寶',
    hospWarn: '請勿嘗試由 D 出口徒步前往！距離過遠（需步行約 20–25 分鐘），必須乘搭接駁巴士或小巴。',
    hospFromKat: '由啟德站出發', hospOther: '其他直達路線（不經啟德站）', hospBoard: '{exit} 出口上車', hospSign: '上車位置以站牌為準',
    opCTB: '城巴', opKMB: '九巴', opGMB: '專線小巴', opREHAB: '復康巴士',
    fxTitle: '外幣找換指南', fxLocal: '啟德站周邊', fxLocalNote: '啟德站一帶暫未找到可核實的獨立找換店，可使用以下銀行的外幣服務：',
    fxHot: '熱門車站找換店', fxRoute: '查看轉乘路線', fxMap: '地圖搜尋找換店', fxSummary: '約 {m} 分鐘・八達通 {f}・{x}', fxDirect: '直達', fxTransfers: '轉車 {n} 次',
    fxTips: '找換前請先比較買入／賣出匯率，並問清楚實收總額；只應光顧持有海關「金錢服務經營者」牌照的找換店。', fxLicence: '查閱海關持牌人登記冊',
  },
  en: {
    octBanner: 'Physical Octopus cards are not sold at Kai Tak Station. Buy one at a station with a full Customer Service Centre counter (e.g. Diamond Hill or Ho Man Tin), or use Mobile Octopus.',
    tvmTitle: 'Ticket machines at Kai Tak', tvmFuncLabel: 'Services', tvmFuncs: ['Octopus top-up', 'Check balance', 'Monthly Pass', 'Single journey ticket', 'MTR City Saver'],
    tvmPayLabel: 'Payment', tvmPayOk: 'Octopus or HKD cash only', tvmPayNo: 'No credit cards, WeChat Pay or Alipay',
    hospWarn: 'Do not try to walk from Exit D! It is too far (about 20–25 minutes on foot). Take a feeder bus or minibus.',
    hospFromKat: 'From Kai Tak Station', hospOther: 'Other direct routes (not via Kai Tak Station)', hospBoard: 'Board at Exit {exit}', hospSign: 'Check the stop sign for the boarding point',
    opCTB: 'Citybus', opKMB: 'KMB', opGMB: 'Minibus', opREHAB: 'Rehabus',
    fxTitle: 'Money exchange guide', fxLocal: 'Around Kai Tak Station', fxLocalNote: 'No verified standalone money changer was found near Kai Tak Station. These banks offer foreign currency services:',
    fxHot: 'Money changers at popular stations', fxRoute: 'See MTR route', fxMap: 'Find changers on map', fxSummary: '~{m} min · Octopus {f} · {x}', fxDirect: 'Direct', fxTransfers: '{n} change(s)',
    fxTips: 'Compare buy and sell rates and ask for the total before exchanging. Only use money changers licensed by Customs as Money Service Operators.', fxLicence: 'Check the Customs register of licensees',
  },
  ko: {
    octBanner: '카이탁역에서는 실물 옥토퍼스 카드를 판매하지 않습니다. 고객서비스센터 창구가 있는 역(다이아몬드힐역, 호만틴역 등)에서 구매하거나 모바일 옥토퍼스를 이용하세요.',
    tvmTitle: '카이탁역 자동발매기', tvmFuncLabel: '이용 가능 서비스', tvmFuncs: ['옥토퍼스 충전', '잔액 조회', '월정액 패스', '편도 승차권', 'MTR 시티 세이버'],
    tvmPayLabel: '결제 수단', tvmPayOk: '옥토퍼스 또는 홍콩달러 현금만 가능', tvmPayNo: '신용카드, 위챗페이, 알리페이 불가',
    hospWarn: 'D 출구에서 걸어가지 마세요! 거리가 멀어 도보 약 20–25분이 걸립니다. 연계 버스나 미니버스를 이용하세요.',
    hospFromKat: '카이탁역 출발', hospOther: '기타 직행 노선 (카이탁역 미경유)', hospBoard: '{exit} 출구에서 승차', hospSign: '승차 위치는 정류장 표지판을 확인하세요',
    opCTB: '시티버스', opKMB: 'KMB', opGMB: '미니버스', opREHAB: '재활 버스',
    fxTitle: '환전 안내', fxLocal: '카이탁역 주변', fxLocalNote: '카이탁역 주변에서 확인된 독립 환전소는 없습니다. 다음 은행의 외화 서비스를 이용하세요:',
    fxHot: '인기 역 주변 환전소', fxRoute: 'MTR 경로 보기', fxMap: '지도에서 환전소 찾기', fxSummary: '약 {m}분 · 옥토퍼스 {f} · {x}', fxDirect: '직통', fxTransfers: '환승 {n}회',
    fxTips: '환전 전 매입·매도 환율을 비교하고 최종 금액을 확인하세요. 세관의 금전서비스업자 면허가 있는 환전소만 이용하세요.', fxLicence: '세관 면허 등록부 확인',
  },
  ja: {
    octBanner: '啓徳駅では実物のオクトパスカードを販売していません。カスタマーサービスセンター窓口のある駅（鑽石山駅、何文田駅など）で購入するか、モバイルオクトパスをご利用ください。',
    tvmTitle: '啓徳駅の自動券売機', tvmFuncLabel: '利用できるサービス', tvmFuncs: ['オクトパスのチャージ', '残高照会', '全月通', '片道きっぷ', 'MTR 都会票'],
    tvmPayLabel: '支払方法', tvmPayOk: 'オクトパスまたは香港ドル現金のみ', tvmPayNo: 'クレジットカード、WeChat Pay、Alipay は利用不可',
    hospWarn: 'D出口から歩いて行かないでください！距離が遠く徒歩約20–25分かかります。連絡バスまたはミニバスをご利用ください。',
    hospFromKat: '啓徳駅から', hospOther: 'その他の直通路線（啓徳駅を経由しない）', hospBoard: '{exit} 出口で乗車', hospSign: '乗車位置は停留所の標識で確認してください',
    opCTB: 'シティバス', opKMB: 'KMB', opGMB: 'ミニバス', opREHAB: 'リハビリバス',
    fxTitle: '両替ガイド', fxLocal: '啓徳駅周辺', fxLocalNote: '啓徳駅周辺で確認できた独立系の両替店はありません。以下の銀行の外貨サービスをご利用ください：',
    fxHot: '主要駅周辺の両替店', fxRoute: 'MTR ルートを見る', fxMap: '地図で両替店を探す', fxSummary: '約 {m} 分・オクトパス {f}・{x}', fxDirect: '直通', fxTransfers: '乗換 {n} 回',
    fxTips: '両替前に買値・売値を比較し、受取総額を確認してください。税関の金銭サービス業者ライセンスを持つ両替店のみ利用しましょう。', fxLicence: '税関のライセンス登録簿を確認',
  },
};
Object.keys(UI_V7).forEach((l) => Object.assign(UI[l], UI_V7[l]));
const UI_V71 = {
  zh: { hospLive: '實時到站', hospLoading: '正在載入實時班次…', hospNoLive: '未能載入實時班次', hospAtStop: '於「{stop}」上車' },
  en: { hospLive: 'Live ETA', hospLoading: 'Loading live arrivals…', hospNoLive: 'Live arrivals unavailable', hospAtStop: 'Board at "{stop}"' },
  ko: { hospLive: '실시간 도착', hospLoading: '실시간 도착 정보 불러오는 중…', hospNoLive: '실시간 도착 정보를 불러올 수 없음', hospAtStop: '"{stop}"에서 승차' },
  ja: { hospLive: 'リアルタイム', hospLoading: 'リアルタイム情報を読み込み中…', hospNoLive: 'リアルタイム情報を取得できません', hospAtStop: '「{stop}」で乗車' },
};
Object.keys(UI_V71).forEach((l) => Object.assign(UI[l], UI_V71[l]));
const UI_V8 = {
  zh: { dMall: '商場／區域', dCuisine: '菜式', dAll: '全部', walkNote: '步行時間為估算；食肆經常轉換，出發前請以 Google 地圖為準。', fMall: '商場／區域', fCuisine: '菜式', fFloor: '樓層及舖號', fWalk: '步行分鐘（例如 3–5）' },
  en: { dMall: 'Mall / area', dCuisine: 'Cuisine', dAll: 'All', walkNote: 'Walking times are estimates. Restaurants change often, so check Google Maps before you go.', fMall: 'Mall / area', fCuisine: 'Cuisine', fFloor: 'Floor and shop no.', fWalk: 'Walking minutes (e.g. 3–5)' },
  ko: { dMall: '쇼핑몰·지역', dCuisine: '요리 종류', dAll: '전체', walkNote: '도보 시간은 예상치입니다. 식당은 자주 바뀌므로 방문 전 Google 지도를 확인하세요.', fMall: '쇼핑몰·지역', fCuisine: '요리 종류', fFloor: '층·점포 번호', fWalk: '도보 분 (예: 3–5)' },
  ja: { dMall: 'モール・エリア', dCuisine: 'ジャンル', dAll: 'すべて', walkNote: '徒歩時間は目安です。飲食店は入れ替わりが多いため、事前に Google マップでご確認ください。', fMall: 'モール・エリア', fCuisine: 'ジャンル', fFloor: '階・店舗番号', fWalk: '徒歩分数（例：3–5）' },
};
Object.keys(UI_V8).forEach((l) => Object.assign(UI[l], UI_V8[l]));
const UI_V9 = {
  zh: { searchDining: '🔍 搜尋餐廳名稱、菜式或美食 (例如: 拉麵、CAFE、壽司)...', dAllCuisine: '全部分類', dPopularMall: '熱門商場' },
  en: { searchDining: '🔍 Search restaurants, cuisines or food (e.g. ramen, café, sushi)...', dAllCuisine: 'All cuisines', dPopularMall: 'Popular malls' },
  ko: { searchDining: '🔍 식당 이름, 요리 종류, 음식 검색 (예: 라멘, 카페, 스시)...', dAllCuisine: '전체 분류', dPopularMall: '인기 쇼핑몰' },
  ja: { searchDining: '🔍 店名・ジャンル・料理で検索（例：ラーメン、カフェ、寿司）...', dAllCuisine: 'すべてのジャンル', dPopularMall: '人気モール' },
};
Object.keys(UI_V9).forEach((l) => Object.assign(UI[l], UI_V9[l]));
const UI_V10 = {
  zh: { concourse: '車站大堂（閘外）' }, en: { concourse: 'Station concourse' }, ko: { concourse: '역 대합실' }, ja: { concourse: '駅構内' },
};
Object.keys(UI_V10).forEach((l) => Object.assign(UI[l], UI_V10[l]));
const UI_V11 = {
  zh: { searchDining: '🔍 搜尋餐廳名稱、菜式 (例如: 麥當勞、拉麵、CAFE、壽司)...', dArea: '區域', dAllArea: '全部區域' },
  en: { searchDining: "🔍 Search restaurants or cuisines (e.g. McDonald's, ramen, café, sushi)...", dArea: 'Area', dAllArea: 'All areas' },
  ko: { searchDining: '🔍 식당 이름·요리 검색 (예: 맥도날드, 라멘, 카페, 스시)...', dArea: '지역', dAllArea: '전체 지역' },
  ja: { searchDining: '🔍 店名・ジャンルで検索（例：マクドナルド、ラーメン、カフェ、寿司）...', dArea: 'エリア', dAllArea: 'すべてのエリア' },
};
Object.keys(UI_V11).forEach((l) => Object.assign(UI[l], UI_V11[l]));
const UI_V12 = {
  zh: { etaTitle: '實時到站（由啟德站附近上車）', etaCtb: '城巴 {r}', etaGmb: '{r}小巴', etaFallback: '暫未能取得實時班次，請以站牌班次表為準', etaNone: '附近暫無相關路線資料' },
  en: { etaTitle: 'Live arrivals (boarding near Kai Tak Station)', etaCtb: 'Citybus {r}', etaGmb: 'Minibus {r}', etaFallback: 'Live times unavailable; check the timetable at the stop', etaNone: 'No matching routes nearby' },
  ko: { etaTitle: '실시간 도착 (카이탁역 근처 승차)', etaCtb: '시티버스 {r}', etaGmb: '미니버스 {r}', etaFallback: '실시간 정보를 불러올 수 없습니다. 정류장 시간표를 확인하세요', etaNone: '주변에 해당 노선 정보가 없습니다' },
  ja: { etaTitle: 'リアルタイム到着（啓徳駅付近で乗車）', etaCtb: 'シティバス {r}', etaGmb: 'ミニバス {r}', etaFallback: 'リアルタイム情報を取得できません。停留所の時刻表をご確認ください', etaNone: '周辺に該当する路線情報がありません' },
};
Object.keys(UI_V12).forEach((l) => Object.assign(UI[l], UI_V12[l]));
const fmt = (s, v) => s.replace(/\{(\w+)\}/g, (_, k) => v[k] ?? '');
const tx = (obj, lang) => (obj && (obj[lang] || (lang === 'ja' ? obj.zh || obj.en : obj.en || obj.zh))) || '';

/* ============================ 分類 ============================ */
const CATS = [
  { id: 'all', Icon: LayoutGrid, label: { zh: '全部', en: 'All', ko: '전체', ja: 'すべて' } },
  { id: 'shopping', Icon: ShoppingBag, emoji: '🛍️', label: { zh: '文娛/購物', en: 'Leisure & Shopping', ko: '쇼핑·문화', ja: 'ショッピング' } },
  { id: 'dining', Icon: UtensilsCrossed, emoji: '🍽️', label: { zh: '美食餐飲', en: 'Dining', ko: '맛집·식당', ja: 'グルメ' } },
  { id: 'residential', Icon: Home, emoji: '🏠', label: { zh: '住宅屋苑', en: 'Residential', ko: '주거단지', ja: '住宅' } },
  { id: 'education', Icon: GraduationCap, emoji: '🏫', label: { zh: '學校/教育', en: 'Schools', ko: '학교·교육', ja: '学校・教育' } },
  { id: 'government', Icon: Landmark, emoji: '🏛️', label: { zh: '政府/公共', en: 'Government', ko: '정부·공공', ja: '政府・公共' } },
  { id: 'medical', Icon: HeartPulse, emoji: '🏥', label: { zh: '醫療/健康', en: 'Medical', ko: '의료·건강', ja: '医療・健康' } },
  { id: 'industry', Icon: Factory, emoji: '🏭', label: { zh: '工商業區', en: 'Business', ko: '상공업지구', ja: '商工業エリア' } },
  { id: 'sports', Icon: Ship, emoji: '🚢', label: { zh: '體育/景點', en: 'Sports & Sights', ko: '스포츠·명소', ja: 'スポーツ・観光' } },
  { id: 'bank', Icon: Banknote, emoji: '🏦', label: { zh: '銀行/找換店', en: 'Banks & FX', ko: '은행·환전', ja: '銀行・両替' } },
  { id: 'transport', Icon: Bus, emoji: '🚌', label: { zh: '接駁交通', en: 'Transport', ko: '환승 교통', ja: '交通乗換' } },
];
const catById = (id) => CATS.find((c) => c.id === id) || CATS[0];
const EXITS = ['A', 'B1', 'B2', 'C', 'D', 'B1/B2', 'KAT']; // KAT = 車站大堂（毋須出站）

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
  bank: { ko: '은행·ATM·외화 서비스', ja: '銀行・ATM・外貨サービス' },
  dining: { ko: '식당·푸드 구역', ja: 'レストラン・飲食エリア' },
};
const EXIT_TIP = {
  A: { zh: 'A 出口連接啟德車站廣場及公共運輸交匯處，出站後按街道指示牌前往。', en: 'Exit A leads to Kai Tak Station Square and the public transport interchange. Follow the street signs.', ko: 'A 출구는 카이탁역 광장과 환승센터로 연결됩니다. 거리 표지판을 따라가세요.', ja: 'A出口は啓徳駅前広場と公共交通ターミナルに通じています。案内標識に従ってください。' },
  B1: { zh: 'B1 出口可經行人天橋前往新蒲崗及東啟德一帶。', en: 'From Exit B1, take the footbridge towards San Po Kong and East Kai Tak.', ko: 'B1 출구에서 보행 육교를 이용해 산포콩·동카이탁 방면으로 이동하세요.', ja: 'B1出口から歩道橋で新蒲崗・東啓徳方面へ。' },
  B2: { zh: 'B2 出口直達天璽天，亦可經行人天橋前往新蒲崗。', en: 'Exit B2 leads straight to Tin Sai Tin, with a footbridge to San Po Kong.', ko: 'B2 출구는 틴사이틴으로 바로 연결되며, 육교로 산포콩에 갈 수 있습니다.', ja: 'B2出口は天璽天に直結。歩道橋で新蒲崗へも行けます。' },
  C: { zh: 'C 出口往 AIRSIDE 一帶及新蒲崗東面（太子道東沿線）。', en: 'Exit C leads towards AIRSIDE and the eastern side of San Po Kong along Prince Edward Road East.', ko: 'C 출구는 AIRSIDE 및 산포콩 동쪽(프린스 에드워드 로드 이스트) 방면입니다.', ja: 'C出口はAIRSIDE方面と新蒲崗東側（太子道東沿い）へ。' },
  D: { zh: 'D 出口往啟德體育園、跑道區方向及 D 出口公共運輸交匯處。', en: 'Exit D leads to Kai Tak Sports Park, the runway area and the Exit D transport interchange.', ko: 'D 출구는 카이탁 스포츠파크, 활주로 지구 및 D 출구 환승센터 방면입니다.', ja: 'D出口は啓徳スポーツパーク、ランウェイ地区、D出口交通ターミナル方面へ。' },
  KAT: { zh: '位於啟德站大堂閘外，毋須出站。', en: 'In the station concourse outside the gates; no need to exit.', ko: '역 대합실 개찰구 밖에 있어 출구로 나갈 필요가 없습니다.', ja: '駅コンコースの改札外にあり、出口を出る必要はありません。' },
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
/* ============================ 美食餐飲：商場／菜式分類 ============================ */
// exit：預設建議出口；walk：由該出口步行的估算分鐘；q：Google 地圖搜尋時附加的地點字眼
const MALLS = {
  chinglong: { exit: 'A', walk: '5', q: '晴朗商場', label: { zh: '晴朗商場', en: 'Ching Long Shopping Centre', ko: '칭롱 쇼핑센터', ja: '晴朗商場' } },
  airside: { exit: 'C', walk: '3–5', q: 'AIRSIDE', label: { zh: 'AIRSIDE', en: 'AIRSIDE', ko: 'AIRSIDE', ja: 'AIRSIDE' } },
  mikiki: { exit: 'C', walk: '10–13', q: 'Mikiki', label: { zh: 'Mikiki', en: 'Mikiki', ko: 'Mikiki', ja: 'Mikiki' } },
  twins: { exit: 'B1', walk: '1–3', q: '雙子匯', label: { zh: '雙子匯', en: 'The Twins', ko: '더 트윈스', ja: 'The Twins（雙子匯）' } },
  // 啟德體育園區（以啟德站 D 出口經啟德車站廣場步行為準）
  ktsp: { exit: 'D', walk: '5–8', mq: '啟德體育園', label: { zh: '啟德體育園區', en: 'Kai Tak Sports Park', ko: '카이탁 스포츠파크', ja: '啓徳スポーツパーク' },
    note: { zh: '經啟德車站廣場前往', en: 'via Kai Tak Station Square', ko: '카이탁역 광장 경유', ja: '啓徳駅前広場経由' } },
  // 新居屋及公營房屋圈
  kaiyan: { exit: 'A', walk: '5–10', q: '啟欣苑', label: { zh: '啟欣苑', en: 'Kai Yan Court', ko: '카이얀 코트', ja: '啓欣苑' } },
  kaiyuet: { exit: 'D', walk: '8–10', q: '啟悅苑', label: { zh: '啟悅苑', en: 'Kai Yuet Court', ko: '카이윗 코트', ja: '啓悦苑' } },
  kaiying: { exit: 'D', walk: '8–10', q: '啟盈苑', label: { zh: '啟盈苑', en: 'Kai Ying Court', ko: '카이잉 코트', ja: '啓盈苑' } },
  lph: { exit: 'D', walk: '', q: '世運道', label: { zh: '世運道簡約公屋', en: 'Olympic Avenue Light Public Housing', ko: '올림픽 애비뉴 간이 공공주택', ja: '世運道簡易公営住宅' } },
  // 沐泰街／沐寧街私人屋苑地舖
  // 啟德跑道區（承豐道沿線）：距離車站較遠，以港鐵官方指南的接駁巴士為準（A 出口上車）
  runway: { exit: 'A', walk: '', mq: '啟德承豐道', label: { zh: '跑道區／承豐道', en: 'Runway area / Shing Fung Road', ko: '활주로 지구·싱펑 로드', ja: 'ランウェイ地区・承豊道' },
    transfer: { zh: '啟德站 A 出口轉乘城巴 22X（往維港1號）或 22D（往跑道區，只限繁忙時間）', en: 'From Kai Tak Station Exit A, take Citybus 22X (to One Victoria) or 22D (to the runway area, peak hours only)', ko: '카이탁역 A 출구에서 시티버스 22X(원 빅토리아행) 또는 22D(활주로 지구행, 혼잡 시간대만) 환승', ja: '啓徳駅A出口からシティバス22X（維港1号行き）または22D（ランウェイ地区行き・ラッシュ時のみ）に乗り換え' } },
  muktai: { exit: 'D', walk: '5–10', label: { zh: '沐泰街屋苑地舖', en: 'Muk Tai Street shops', ko: '묵타이 스트리트 상점가', ja: '沐泰街の店舗' } },
  cullinan: { exit: 'B2', walk: '1–3', q: '天璽天', label: { zh: '天璽天Mall', en: 'Cullinan Sky Mall', ko: 'Cullinan Sky Mall', ja: '天璽天Mall' } },
  kat: { exit: 'KAT', walk: '', q: '啟德站', label: { zh: '啟德站大堂', en: 'Kai Tak Station', ko: '카이탁역 대합실', ja: '啓徳駅構内' } },
  other: { exit: 'A', walk: '', q: '', label: { zh: '其他', en: 'Others', ko: '기타', ja: 'その他' } },
};
const CUISINES = {
  fastfood: { zh: '連鎖快餐', en: 'Fast food', ko: '패스트푸드', ja: 'ファストフード' },
  hkcafe: { zh: '港式茶餐廳／粉麵', en: 'HK café & noodles', ko: '홍콩식 차찬텡·국수', ja: '香港式喫茶・麺' },
  japanese: { zh: '日式料理', en: 'Japanese', ko: '일식', ja: '和食' },
  ramen: { zh: '拉麵／烏冬', en: 'Ramen & udon', ko: '라멘·우동', ja: 'ラーメン・うどん' },
  bbq: { zh: '燒肉', en: 'Yakiniku / BBQ', ko: '야키니쿠·고기구이', ja: '焼肉' },
  korean: { zh: '韓式', en: 'Korean', ko: '한식', ja: '韓国料理' },
  hotpot: { zh: '火鍋', en: 'Hotpot', ko: '훠궈·샤부샤부', ja: '鍋料理' },
  chinese: { zh: '中菜／台菜', en: 'Chinese & Taiwanese', ko: '중식·대만식', ja: '中華・台湾料理' },
  sea: { zh: '泰國／東南亞', en: 'Thai & SE Asian', ko: '태국·동남아', ja: 'タイ・東南アジア' },
  western: { zh: '西式／意式', en: 'Western & Italian', ko: '양식·이탈리안', ja: '洋食・イタリアン' },
  fusion: { zh: '創意 Fusion', en: 'Fusion', ko: '퓨전', ja: '創作料理' },
  cafe: { zh: '咖啡室', en: 'Café', ko: '카페', ja: 'カフェ' },
  dessert: { zh: '甜品', en: 'Desserts', ko: '디저트', ja: 'スイーツ' },
  drinks: { zh: '茶飲', en: 'Tea & drinks', ko: '차·음료', ja: 'ドリンク' },
  bakery: { zh: '餅店／麵包', en: 'Bakery', ko: '베이커리', ja: 'ベーカリー' },
  bar: { zh: '酒吧／Sports Bar', en: 'Bar & sports bar', ko: '바·스포츠 바', ja: 'バー・スポーツバー' },
  conv: { zh: '便利店／輕食', en: 'Convenience store & snacks', ko: '편의점·간식', ja: 'コンビニ・軽食' },
  foodcourt: { zh: '美食廣場', en: 'Food court', ko: '푸드코트', ja: 'フードコート' },
  area: { zh: '美食區', en: 'Dining area', ko: '식당가', ja: '飲食エリア' },
};
const TRANSFER_CRUISE = { zh: '啟德站 A 出口轉乘城巴 22M 往啟德郵輪碼頭', en: 'From Kai Tak Station Exit A, take Citybus 22M to Kai Tak Cruise Terminal', ko: '카이탁역 A 출구에서 시티버스 22M으로 카이탁 크루즈 터미널까지', ja: '啓徳駅A出口からシティバス22Mで啓徳クルーズターミナルへ' };
const TRANSFER_RUNWAY = { zh: '啟德站 A 出口轉乘城巴 22X（往維港1號）或 22D（往跑道區，只限繁忙時間）', en: 'From Kai Tak Station Exit A, take Citybus 22X (to One Victoria) or 22D (to the runway area, peak hours only)', ko: '카이탁역 A 출구에서 시티버스 22X(원 빅토리아행) 또는 22D(활주로 지구행, 혼잡 시간대만) 환승', ja: '啓徳駅A出口からシティバス22X（維港1号行き）または22D（ランウェイ地区行き・ラッシュ時のみ）に乗り換え' };
const walkText = (exit, walk, lang, note) => {
  if (exit === 'KAT') return { zh: '位於啟德站大堂閘外，毋須出站', en: 'In the station concourse outside the gates', ko: '역 대합실 개찰구 밖', ja: '駅構内の改札外' }[lang] || '';
  if (!walk) return '';
  const base = { zh: `${exit} 出口步行約 ${walk} 分鐘`, en: `About ${walk} min walk from Exit ${exit}`, ko: `${exit} 출구에서 도보 약 ${walk}분`, ja: `${exit}出口から徒歩約${walk}分` }[lang] || '';
  const n = note && (note[lang] || note.en);
  return n ? `${base}（${n}）` : base;
};

// mkR(id, 商場／區域, 菜式, 中文名, 英文名, 樓層舖號, 中文簡介, 英文簡介, 選項?)
// 選項可為出口字串（例如 'B1'），或 { exit, q }：q 為 Google 地圖搜尋時附加的地點字眼
function mkR(id, mall, cuisine, zh, en, floor, dZh, dEn, opt) {
  const m = MALLS[mall];
  const o = typeof opt === 'string' ? { exit: opt } : (opt || {});
  const exit = o.exit || m.exit;
  const walk = mall === 'twins' && exit === 'A' ? '2–4' : (mall === 'other' ? '' : m.walk);
  const meta = { mall, cuisine, floor: { zh: floor, en: floor }, walk };
  const note = mall === 'ktsp' ? m.note : null;
  if (note) meta.note = note;
  const transfer = o.transfer || m.transfer || null; // 跑道區：改為顯示巴士接駁提示
  if (transfer) meta.transfer = transfer;
  const tipOf = (l) => (transfer ? (transfer[l] || transfer.en) : walkText(exit, walk, l, note));
  // Google 地圖搜尋字眼：體育園區用「餐廳名稱 啟德體育園」；啟欣苑用「餐廳名稱 啟欣苑」；其他用「餐廳名稱 啟德 商場」
  const mapQuery = o.q ? `${zh} 啟德 ${o.q}` : m.mq ? `${zh} ${m.mq}` : `${zh} 啟德${m.q ? ` ${m.q}` : ''}`;
  return {
    id, category: 'dining', exit,
    name: { zh, en, ko: en, ja: zh },
    desc: { zh: dZh, en: dEn, ko: `${CUISINES[cuisine].ko} · ${m.label.ko}`, ja: `${CUISINES[cuisine].ja}・${m.label.ja}` },
    tip: { zh: tipOf('zh'), en: tipOf('en'), ko: tipOf('ko'), ja: tipOf('ja') },
    mapQuery,
    meta,
  };
}

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
  mk('p23-hkch', 'medical', 'C', '香港兒童醫院', "Hong Kong Children's Hospital", '全港首間專科兒童醫院，位於啟德承昌道1號。', "Hong Kong's dedicated children's hospital at 1 Shing Cheong Road, Kai Tak.",
    ['請勿由 D 出口步行前往。建議於 C 出口乘搭城巴 22S，或於 A 出口乘搭城巴 22M。', 'Do not walk from Exit D. Take Citybus 22S from Exit C or Citybus 22M from Exit A.']),
  mk('p24-irc', 'government', 'C', '稅務中心', 'Inland Revenue Centre', '稅務局總部所在地。', 'Headquarters of the Inland Revenue Department.'),
  mk('p25-kt-arena', 'sports', 'D', '啟德體藝館', 'Kai Tak Arena', '室內體育及文娛表演場館。', 'Indoor arena for sports and performances.'),
  mk('p26-avenue-park', 'sports', 'A', '啟德大道公園', 'Kai Tak Avenue Park', '沿啟德大道而建的休憩公園。', 'Landscaped park along Kai Tak Avenue.'),
  mk('p27-kt-hall', 'government', 'C', '啟德社區會堂', 'Kai Tak Community Hall', '供區內團體舉辦活動的社區會堂。', 'Community hall for local events and activities.'),
  mk('p28-ekt-playground', 'sports', 'B1', '東啟德遊樂場', 'Kai Tak East Playground', '設球場及兒童遊樂設施的遊樂場。', "Playground with sports courts and children's play facilities."),
  mk('p29-ekt-sports', 'sports', 'B1', '東啟德體育館', 'Kai Tak East Sports Centre', '康文署室內體育館。', 'LCSD indoor sports centre.'),
  mk('p30-kt-hosp', 'medical', 'C', '啟德醫院', 'Kai Tak Hospital', '位於啟德承昌道1號，毗鄰香港兒童醫院。2026 年 10 月 5 日起分階段投入服務，首階段為專科門診大樓及腫瘤科大樓，逐步承接伊利沙伯醫院的臨床服務。', "At 1 Shing Cheong Road, Kai Tak, next to Hong Kong Children's Hospital. Phased opening from 5 October 2026, starting with the Specialist Outpatient Block and the Oncology Block, gradually taking over services from Queen Elizabeth Hospital.",
    ['請勿由 D 出口步行前往。建議於 C 出口乘搭城巴 22S，或於 A 出口乘搭城巴 22M。', 'Do not walk from Exit D. Take Citybus 22S from Exit C or Citybus 22M from Exit A.']),
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

  /* 啟德跑道區住宅（承豐道沿線；距離車站較遠，請轉乘巴士） */
  mk('rw-one-victoria', 'residential', 'A', '維港1號', 'One Victoria', '承豐道21號的私人屋苑，2022 年落成，共 1,059 伙。', 'Private estate at 21 Shing Fung Road, completed in 2022 with 1,059 flats.', ['啟德站 A 出口轉乘城巴 22X 直達維港1號。', 'From Kai Tak Station Exit A, take Citybus 22X straight to One Victoria.'], '維港1號 啟德承豐道'),
  mk('rw-knightsbridge', 'residential', 'A', '天瀧', 'The Knightsbridge', '承豐道22號的私人屋苑，共 566 伙。', 'Private estate at 22 Shing Fung Road with 566 flats.', ['啟德站 A 出口轉乘城巴 22X（維港1號站下車，步行約 1 分鐘）。', 'From Kai Tak Station Exit A, take Citybus 22X to the One Victoria stop, then walk about 1 min.'], '天瀧 啟德承豐道'),
  mk('rw-double-coast', 'residential', 'A', '維港．雙鑽', 'Double Coast', '承豐里2號一帶的跑道區私人屋苑。', 'Runway-area private estate around 2 Shing Fung Lane.', [TRANSFER_RUNWAY.zh, TRANSFER_RUNWAY.en], '維港雙鑽 啟德承豐道'),
  mk('rw-miami-quay', 'residential', 'A', 'Miami Quay', 'Miami Quay', '啟德跑道區私人屋苑。', 'Private estate in the Kai Tak runway area.', [TRANSFER_RUNWAY.zh, TRANSFER_RUNWAY.en], 'Miami Quay 啟德承豐道'),
  mk('rw-kt-marina', 'residential', 'A', '啟德海灣', 'KT Marina', '啟德跑道區私人屋苑。', 'Private estate in the Kai Tak runway area.', [TRANSFER_RUNWAY.zh, TRANSFER_RUNWAY.en], '啟德海灣 啟德承豐道'),
  mk('rw-pavo-crest', 'residential', 'A', '澐璟', 'Pavo Crest', '啟德跑道區私人屋苑。', 'Private estate in the Kai Tak runway area.', [TRANSFER_RUNWAY.zh, TRANSFER_RUNWAY.en], '澐璟 啟德承豐道'),

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
    ['C 出口巴士站上車；星期一至五 10:30–19:30 設短途班次直達兩間醫院。上車前請核對車頭路線號碼。', 'Board at the bus stop by Exit C. Mon–Fri 10:30–19:30 short trips go straight to both hospitals. Check the route number before boarding.'], '啟德站 C出口 巴士站'),
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
  /* ---------- 新增：最新落成學校 ---------- */
  mk('e74-baptist-rainbow', 'education', 'A', '浸信會孔憲紹天虹小學', 'Baptist Hung Hin Shiu Rainbow Primary School', '位於九龍啟德沐安街2號的新校舍，前身為黃大仙的浸信會天虹小學，2025 年 9 月起改用現名並改屬九龍城 34 校網。', 'New campus at 2 Muk On Street, Kai Tak. Formerly Baptist Rainbow Primary School in Wong Tai Sin, renamed in September 2025.',
    ['經 A 出口沿車站廣場／沐安街步行約 3 至 5 分鐘。', 'From Exit A, walk via Kai Tak Station Square and Muk On Street, about 3 to 5 min.'], '浸信會孔憲紹天虹小學'),

  /* ---------- 美食餐飲（2026 年 10 月整理：主要依據中電「九龍城區食肆」商戶名單（2026 年 9 月 18 日更新）及 2025–2026 年飲食媒體報道；食肆經常轉換，出發前請以 Google 地圖為準） ---------- */
  // 步行時間為由建議出口出發的估算

  /* 晴朗商場（A 出口） */
  mkR('r-cl-mcd', 'chinglong', 'fastfood', '麥當勞', "McDonald's", 'G/F B001', '漢堡及快餐。', 'Burgers and fast food.'),
  mkR('r-cl-cdc', 'chinglong', 'fastfood', '大家樂', 'Café de Coral', '1/F A101', '港式連鎖快餐，供應早午晚餐及下午茶。', 'Hong Kong fast-food chain serving all-day meals and afternoon tea.'),
  mkR('r-cl-jasmine', 'chinglong', 'chinese', '茶皇殿', 'Jasmine Cuisine', '1/F A102', '粵菜酒家，供應點心。', 'Cantonese restaurant with dim sum.'),
  mkR('r-cl-chiukee', 'chinglong', 'hkcafe', '潮記粉麵', 'Chiu Kee Noodles', 'G/F A030', '地道粉麵店。', 'Local noodle shop.'),
  mkR('r-cl-hungs', 'chinglong', 'hkcafe', '鴻仔記車仔麵', "Hung's Cart Noodles", 'G/F A029', '車仔麵，自選配料。', 'Cart noodles with toppings of your choice.'),
  mkR('r-cl-kongnam', 'chinglong', 'chinese', '港南湘蜀食堂', 'Kong Nam Canteen', 'B 區 G/F B19', '湘菜及川菜小館。', 'Hunan and Sichuan eatery.'),
  mkR('r-cl-hft', 'chinglong', 'drinks', '鴻福堂', 'Hung Fook Tong', 'G/F A018', '涼茶、湯水及小食。', 'Herbal teas, soups and snacks.'),

  /* AIRSIDE（C 出口） */
  mkR('r-ai-mcd', 'airside', 'fastfood', '麥當勞', "McDonald's", 'B1 B117', '漢堡及快餐，設 McCafé（07:00–23:00）。', "Burgers and fast food, with a McCafé (07:00–23:00)."),
  mkR('r-ai-starbucks', 'airside', 'cafe', '星巴克', 'Starbucks', 'B1 B130', '連鎖咖啡店。', 'Coffee chain.'),
  mkR('r-ai-uogashi', 'airside', 'japanese', '魚がし日本一', 'Uogashi Nihon-Ichi', 'G/F G001', '立食壽司店，主打日本直送時令壽司。', 'Stand-up sushi bar with seasonal fish from Japan.'),
  mkR('r-ai-machida', 'airside', 'ramen', '橫濱家系 町田商店', 'Machida Shoten', 'G/F G011', '日本橫濱家系拉麵連鎖店。', 'Yokohama iekei-style ramen chain from Japan.'),
  mkR('r-ai-chatterbox', 'airside', 'sea', 'Chatterbox Café', 'Chatterbox Café', 'B1 B114', '星洲菜，招牌文華海南雞飯。', 'Singaporean dishes, famous for Hainanese chicken rice.'),
  mkR('r-ai-nanas', 'airside', 'dessert', "nana's green tea", "nana's green tea", 'B1 B128–B129', '日本抹茶茶室，供應茶飲及抹茶甜品。', 'Japanese matcha café with tea drinks and matcha desserts.'),
  mkR('r-ai-katsugyu', 'airside', 'japanese', '京都勝牛', 'Gyukatsu Kyoto Katsugyu', 'B1 B129', '京都炸牛排專門店。', 'Kyoto-style deep-fried beef cutlet specialist.'),
  mkR('r-ai-homebake', 'airside', 'bakery', 'Homebake', 'Homebake', 'B1 B132A–B132B', '烘焙店，主打飯團包及低溫熟成吐司。', 'Bakery known for rice-ball buns and slow-proofed toast.'),
  mkR('r-ai-chefscuts', 'airside', 'western', "Chef's Cuts", "Chef's Cuts", '2/F 201', '扒房及烘焙，主打乾式熟成牛扒。', 'Steakhouse and bakery known for dry-aged steaks.'),
  mkR('r-ai-thaijam', 'airside', 'sea', '泰沾麵', '泰沾麵', '2/F L205', '泰式粉麵店。', 'Thai noodle shop.'),
  mkR('r-ai-kagura', 'airside', 'bbq', '燒肉火蔵 KAGURA', 'Yakiniku KAGURA', '2/F L206', '日式燒肉店。', 'Japanese yakiniku grill.'),
  mkR('r-ai-senryo', 'airside', 'japanese', '千両', 'SEN-RYO', '2/F L207', '日式壽司及料理。', 'Japanese sushi and dishes.'),
  mkR('r-ai-lanyue', 'airside', 'chinese', '嵐月', 'Lan Yue', '3/F L301–L302', '精緻中菜，招牌叉燒及糯米燒賣。', 'Refined Chinese cuisine, known for char siu and glutinous rice siu mai.'),
  mkR('r-ai-cafe', 'airside', 'cafe', 'AIRSIDE Café', 'AIRSIDE Café', '3/F 322–323', '玻璃屋頂咖啡室，供應新派料理及海鮮菜式。', 'Glass-roofed café serving modern dishes and seafood.'),
  mkR('r-ai-paradise', 'airside', 'chinese', '樂天皇朝薈萃', 'Paradise Dynasty', '4/F 418', '小籠包及中式料理。', 'Xiao long bao and Chinese dishes.'),
  mkR('r-ai-lemon', 'airside', 'drinks', '林香檸', 'Lam Heung Ning', '5/F L501', '手打檸檬茶專門店。', 'Hand-pounded lemon tea specialist.'),
  mkR('r-ai-foodmuse', 'airside', 'foodcourt', 'FOODMUSE 美食廣場', 'FOODMUSE Food Court', '5/F L504–L505', '過萬呎美食廣場，集合多個餐飲品牌，包括幸福巷子（5 號檔）及 JMT（6 號檔）。', 'Food court of over 10,000 sq ft with many brands, incl. Blessed Alley (stall 5) and JMT (stall 6).'),
  mkR('r-ai-dongbaek', 'airside', 'korean', '冬柏 Yuk Mi Jeong Dam', 'Yuk Mi Jeong Dam', '5/F L506', '來自釜山的韓式燒肉店。', 'Korean barbecue from Busan.'),
  mkR('r-ai-coucou', 'airside', 'hotpot', '湊湊火鍋．茶憩', 'Coucou Hotpot & Tea Break', '6/F L603', '台式火鍋連茶飲。', 'Taiwanese-style hotpot with tea drinks.'),
  mkR('r-ai-terrace', 'airside', 'korean', 'Terrace in seaside', 'Terrace in seaside', '6/F 604', '韓式輕食及柑橘甜品，設戶外寵物友善座位。', 'Korean light meals and citrus desserts, with pet-friendly outdoor seats.'),

  /* Mikiki（C 出口） */
  mkR('r-mi-sushiro', 'mikiki', 'japanese', '壽司郎', 'Sushiro', '1/F 110', '迴轉壽司連鎖店。', 'Conveyor-belt sushi chain.'),
  mkR('r-mi-ichigen', 'mikiki', 'ramen', '一幻拉麵', 'Ebisoba Ichigen', '1/F 118A', '蝦湯拉麵專門店。', 'Shrimp-broth ramen specialist.'),
  mkR('r-mi-genki', 'mikiki', 'japanese', '元気寿司', 'Genki Sushi', '1/F 105–105A', '壽司及刺身連鎖店。', 'Sushi and sashimi chain.'),
  mkR('r-mi-gyukaku', 'mikiki', 'bbq', '牛角日本燒肉專門店', 'Gyu-Kaku', '1/F 120', '日式燒肉店，設放題。', 'Japanese yakiniku, with all-you-can-eat options.'),
  mkR('r-mi-plato', 'mikiki', 'western', 'Plato Cafe & Bistro', 'Plato Cafe & Bistro', '1/F 116', '意式及西式料理。', 'Italian and Western dishes.'),
  mkR('r-mi-yakinikulike', 'mikiki', 'bbq', '燒肉LIKE', 'Yakiniku Like', 'G/F G27', '一人燒肉店。', 'Single-person yakiniku.'),
  mkR('r-mi-meetfresh', 'mikiki', 'dessert', '鮮芋仙', 'Meet Fresh', 'G/F G03C', '台灣甜品店。', 'Taiwanese dessert shop.'),
  mkR('r-mi-tapasbrew', 'mikiki', 'western', 'Tapas Brew', 'Tapas Brew', 'G/F G02A', '西班牙餐廳。', 'Spanish restaurant.'),
  mkR('r-mi-dasbier', 'mikiki', 'western', '德國餐廳 Das Bier', 'Das Bier', 'G/F G03B', '德國菜餐廳。', 'German restaurant.'),
  mkR('r-mi-tamjai', 'mikiki', 'fastfood', '譚仔雲南米線', 'TamJai Yunnan Mixian', 'LG LG8', '連鎖雲南米線。', 'Yunnan rice-noodle chain.'),

  /* 雙子匯（1 期 B1 出口；2 期 A 出口） */
  mkR('r-tw-washabu', 'twins', 'hotpot', 'Washabu', 'Washabu', '雙子匯1期 12/F 1202', '日式和牛涮涮鍋，設一人前火鍋。', 'Japanese wagyu shabu-shabu, with single-person sets.', 'B1'),
  mkR('r-tw-sunakku', 'twins', 'japanese', 'Sunakku Mama', 'Sunakku Mama', '雙子匯1期 12/F 1203', '日式小酒館，供應清酒及佐酒小食。', 'Japanese izakaya with sake and bar snacks.', 'B1'),
  mkR('r-tw-okosta', 'twins', 'japanese', 'OKOSTA 御將燒', 'OKOSTA', '雙子匯1期 12/F 1201', '日式料理餐廳。', 'Japanese restaurant.', 'B1'),
  mkR('r-tw-unme', 'twins', 'fusion', 'UnME', 'UnME', '雙子匯1期 14/F 1401', '日、韓、西式新派 Fusion 菜。', 'Modern fusion of Japanese, Korean and Western dishes.', 'B1'),
  mkR('r-tw-nisugu', 'twins', 'fusion', 'Nisugu', 'Nisugu', '雙子匯1期 14/F 1402', '日式居酒屋結合西班牙 Tapas 風格。', 'Japanese izakaya meets Spanish tapas.', 'B1'),
  mkR('r-tw-wowdon', 'twins', 'ramen', 'WOWDON 手工烏冬', 'WOWDON Udon', '雙子匯1期 14/F 1403', '手工烏冬店。', 'Handmade udon shop.', 'B1'),
  mkR('r-tw-santhai', 'twins', 'sea', '新泰東南亞餐廳', '新泰東南亞餐廳', '雙子匯1期 14/F 1404–1405', '東南亞菜餐廳。', 'Southeast Asian restaurant.', 'B1'),
  mkR('r-tw-heya', 'twins', 'chinese', '囍雲軒．HEYA', 'HEYA', '雙子匯1期 15/F 1501–1504', '粵菜酒家，供應點心下午茶。', 'Cantonese restaurant with dim sum.', 'B1'),
  mkR('r-tw-sogocafe', 'twins', 'cafe', 'SOGO Cafe', 'SOGO Cafe', '雙子匯1期 崇光 1/F 106', '崇光百貨內的咖啡室。', 'Café inside SOGO.', 'B1'),
  mkR('r-tw-yonna', 'twins', 'dessert', 'YONNA YONNA Gelato', 'YONNA YONNA Gelato', '雙子匯2期 G/F G16', '意式手工雪糕店。', 'Italian-style gelato shop.', 'A'),

  /* 啟德體育園區：啟德零售館 1／2／3（D 出口） */
  mkR('r-kt-kfc', 'ktsp', 'fastfood', '肯德基', 'KFC', '啟德零售館3 1/F M3-104', '炸雞快餐。', 'Fried chicken fast food.'),
  mkR('r-kt-cdc', 'ktsp', 'fastfood', '大家樂', 'Café de Coral', '啟德零售館3 1/F M3-106', '港式連鎖快餐。', 'Hong Kong fast-food chain.'),
  mkR('r-kt-tamjai3', 'ktsp', 'fastfood', '譚仔三哥米線', 'TamJai SamGor Mixian', '啟德零售館3', '連鎖米線店。', 'Rice-noodle chain.'),
  mkR('r-kt-pizzahut', 'ktsp', 'western', '必勝客', 'Pizza Hut', '啟德零售館3 2/F M3-204', '連鎖薄餅店。', 'Pizza chain.'),
  mkR('r-kt-chaology', 'ktsp', 'hkcafe', '茶東西', 'Chaology', '啟德零售館3 G/F M3-003', '港式茶餐廳。', 'Hong Kong-style café.'),
  mkR('r-kt-wingwah', 'ktsp', 'bakery', '明尚', 'Wing Wah Prestige', '啟德零售館3 1/F M3-102', '榮華餅家旗下餅食店。', 'Pastry shop by Wing Wah.'),
  mkR('r-kt-menwah', 'ktsp', 'hkcafe', '敏華冰廳', 'Men Wah Bing Teng', '啟德零售館1 2/F M1-215', '港式冰室。', 'Hong Kong-style bing sutt café.'),
  mkR('r-kt-ankimdo', 'ktsp', 'korean', '安金稻朝鮮拌飯', 'On Kim Pot Rice', '啟德零售館1 2/F M1-215', '傳統朝鮮拌飯。', 'Traditional Korean bibimbap.'),
  mkR('r-kt-shabudays', 'ktsp', 'hotpot', '好鍋日子', 'Shabu Days', '啟德零售館1 2/F M1-206', '牛角集團一人火鍋品牌。', 'Single-person hotpot brand by the Gyu-Kaku group.'),
  mkR('r-kt-liangpi', 'ktsp', 'chinese', '兩姊妹涼皮 x 株式会社', 'Twins Liangpi x Kabushikigaisha', '啟德零售館1 2/F M1-206', '川式涼皮。', 'Sichuan-style cold noodles.'),
  mkR('r-kt-dumpling', 'ktsp', 'chinese', '餃子鎮', 'Dumpling City', '啟德零售館1 2/F M1-208', '餃子專門店。', 'Dumpling specialist.'),
  mkR('r-kt-bashi', 'ktsp', 'ramen', '一橋拉麵', 'Bashi Ramen', '啟德零售館1 2/F M1-208', '日式拉麵。', 'Japanese ramen.'),
  mkR('r-kt-asam', 'ktsp', 'sea', '亞參雞飯', 'Asam Chicken Rice', '啟德零售館1 2/F M1-208', '馬來西亞海南雞飯。', 'Malaysian chicken rice.'),
  mkR('r-kt-foodgala', 'ktsp', 'foodcourt', 'Food Gala 美食廣場', 'Food Gala', '啟德零售館1 2/F M1-209–214', '約兩萬呎美食廣場，集合多個餐飲品牌，包括幸福巷子、JMT、花鮮甲及幸福羽米線。', 'Food court of about 20,000 sq ft, incl. Blessed Alley, JMT, Fa Sin Gap and Happiness Feather noodles.'),
  mkR('r-kt-watami', 'ktsp', 'japanese', '居食屋「和民」', 'Watami Japanese Dining', '啟德零售館2 G/F M2-017', '日式居酒屋連鎖店。', 'Japanese izakaya chain.'),
  mkR('r-kt-komeda', 'ktsp', 'cafe', "KOMEDA'S Coffee", "KOMEDA'S Coffee", '啟德零售館2 B1 M2-B101（AEON STYLE 內）', '名古屋過江龍日式咖啡店。', 'Nagoya-style Japanese coffee house.'),
  mkR('r-kt-gonuts', 'ktsp', 'cafe', 'GoNuts', 'GoNuts', '啟德零售館2 G/F M2-016', '咖啡室。', 'Café.'),
  mkR('r-kt-pizzamaru', 'ktsp', 'western', 'Pizza Maru', 'Pizza Maru', '啟德零售館2 G/F M2-010', '薄餅店，設運動酒吧及多部高清電視，可觀看體育賽事。', 'Pizza restaurant with a sports bar and HD screens for live games.'),
  mkR('r-kt-nburger', 'ktsp', 'western', 'N+ Burger', 'N+ Burger', '啟德零售館2 1/F M2-102', '航空主題漢堡店。', 'Aviation-themed burger restaurant.'),
  mkR('r-kt-ironcow', 'ktsp', 'chinese', '鐵牛台灣牛肉麵', '鐵牛台灣牛肉麵', '啟德零售館2 1/F M2-103', '台灣牛肉麵店。', 'Taiwanese beef noodle shop.'),
  mkR('r-kt-greyhound', 'ktsp', 'sea', 'Greyhound Café', 'Greyhound Café', '啟德零售館2 1/F M2-112', '泰國菜餐廳。', 'Thai restaurant.'),
  mkR('r-kt-dayvi', 'ktsp', 'dessert', 'Dayvi Gelateria', 'Dayvi Gelateria', '啟德零售館2 1/F M2-115', '意大利手工 Gelato。', 'Italian handmade gelato.'),
  mkR('r-kt-donq', 'ktsp', 'bakery', 'DONQ', 'DONQ', '啟德零售館2 1/F', '日式麵包店。', 'Japanese bakery.'),
  mkR('r-kt-manen', 'ktsp', 'bakery', 'Manen Bakery', 'Manen Bakery', '啟德零售館2 1/F', '麵包店。', 'Bakery.'),
  mkR('r-kt-coffeebread', 'ktsp', 'cafe', 'Coffee and Bread', 'Coffee and Bread', '啟德零售館2 1/F', '咖啡及麵包。', 'Coffee and bread.'),
  mkR('r-kt-liangcha', 'ktsp', 'drinks', '良茶隅', '良茶隅', '啟德零售館2 1/F', '茶飲店。', 'Tea drinks shop.'),
  mkR('r-kt-jiro', 'ktsp', 'ramen', '次郎拉麵', 'Jiro Ramen', '啟德零售館2 2/F', '日式拉麵。', 'Japanese ramen.'),
  mkR('r-kt-seiryu', 'ktsp', 'bar', '清流 Sake Z Plus', 'Sake Z Plus', '啟德零售館2 2/F', '日本清酒專門店及酒吧。', 'Japanese sake shop and bar.'),
  mkR('r-kt-peace', 'ktsp', 'chinese', '和平飯店', 'Peace Cuisine', '啟德零售館2 3/F M2-301', '中菜館。', 'Chinese restaurant.'),
  mkR('r-kt-sharetea', 'ktsp', 'drinks', 'Sharetea 歇腳亭', 'Sharetea', '啟德零售館2 2/F', '台式手搖茶飲。', 'Taiwanese bubble tea.'),
  mkR('r-kt-wangjiasha', 'ktsp', 'chinese', '王家沙．花樣年華', 'Wang Jia Sha', '啟德零售館2 2/F M2-201', '上海菜及點心。', 'Shanghainese dishes and dim sum.'),
  mkR('r-kt-gyukakuj', 'ktsp', 'bbq', '牛角J', 'Gyu-Kaku J', '啟德零售館2 3/F M2-301', '牛角平價副線，主打一人燒肉定食。', "Gyu-Kaku's budget line with single-person yakiniku sets."),
  mkR('r-kt-mingyuen', 'ktsp', 'chinese', '名苑酒家．八珍玉食', 'Ming Yuen Restaurant', '啟德零售館2 3/F M2-310', '約 4,700 呎粵菜酒家。', 'Cantonese restaurant of about 4,700 sq ft.'),
  mkR('r-kt-sushiro', 'ktsp', 'japanese', '壽司郎', 'Sushiro', '啟德零售館2 3/F', '迴轉壽司連鎖店。', 'Conveyor-belt sushi chain.'),
  mkR('r-kt-chowyuet', 'ktsp', 'ramen', '麵鮮醬油房周月', 'Chow Yuet', '啟德零售館2 3/F', '醬油拉麵專門店。', 'Shoyu ramen specialist.'),
  mkR('r-kt-phi', 'ktsp', 'cafe', 'PHI Coffee & Pancake', 'PHI Coffee & Pancake', '啟德體育園 北斗園 G/F NG-001', '咖啡及班戟。', 'Coffee and pancakes.'),
  mkR('r-kt-labaia', 'ktsp', 'western', 'La Baia', 'La Baia', '美食海灣 Dining Cove', '地中海風格現代意大利菜，設海景室內及露天座位，戶外區寵物友善；供應午餐、週末早午餐及晚餐。', 'Modern Mediterranean-style Italian with harbour views and outdoor seating (pet-friendly); lunch, weekend brunch and dinner.'),
  mkR('r-kt-hungrytiger', 'ktsp', 'bar', '餓虎藏龍', 'Hungry Tiger', 'JOYPOLIS SPORTS（運動健康中心）4/F', '創意多國菜及原創雞尾酒；日間為運動主題餐廳，晚上化身酒吧，半開放式露台可眺望主場館。', 'Creative international dishes and cocktails; a sports-themed restaurant by day and bar by night, with a terrace facing the stadium.'),
  mkR('r-kt-champion', 'ktsp', 'bar', 'The Champion 運動酒吧', 'The Champion Sports Bar', '啟德主場館 2/F 東大廳（K 閘入口）', '主場館內約 100 米長的運動酒吧；開業時報道為每日 11:30 起營業，最新營業安排以場館公布為準。', 'Sports bar of about 100 m inside Kai Tak Stadium; reported to open daily from 11:30 at launch. Check the venue for current hours.'),
  mkR('r-kt-nami', 'ktsp', 'japanese', 'Nami Izakaya 浪。居酒屋', 'Nami Izakaya', '啟德零售館', '日式居酒屋。', 'Japanese izakaya.'),
  mkR('r-kt-kaya', 'ktsp', 'sea', '咖吔', '咖吔', '啟德零售館', '新加坡餐廳。', 'Singaporean restaurant.'),
  mkR('r-kt-liangsabei', 'ktsp', 'chinese', '倆仨杯', '倆仨杯', '啟德零售館', '台式餐廳。', 'Taiwanese restaurant.'),
  mkR('dn-dining-cove', 'ktsp', 'area', '美食海灣（Dining Cove）', 'Dining Cove', '', '啟德體育園一帶的餐飲區，活動日人流較多。', 'Dining zone at Kai Tak Sports Park; busy on event days.'),

  /* 天璽天Mall（B2 出口） */
  mkR('r-cs-genki', 'cullinan', 'japanese', '元氣壽司高速線', 'Kousoku Genki', 'B1 B149', '高速線迴轉壽司。', 'Express-lane conveyor sushi.'),
  mkR('r-cs-xiao', 'cullinan', 'chinese', '遇見小麵', 'Xiao Noodles', 'LG LG27', '重慶小麵。', 'Chongqing-style noodles.'),

  /* 啟德站大堂（閘外） */
  mkR('r-kat-arome', 'kat', 'bakery', '東海堂', 'Arome Bakery', 'KAT 4', '麵包西餅店。', 'Bakery and cakes.'),
  mkR('r-kat-hana', 'kat', 'japanese', '華御結', 'Hana-Musubi', 'KAT 5（近 D 出口）', '日式飯糰外賣店。', 'Japanese rice-ball takeaway.'),
  mkR('r-kat-hft', 'kat', 'drinks', '鴻福堂', 'Hung Fook Tong', 'KAT 8', '涼茶、湯水及小食。', 'Herbal teas, soups and snacks.'),

  /* 新居屋及公營房屋圈：啟欣苑（A 出口） */
  mkR('r-ky-daichi', 'kaiyan', 'chinese', '大池小館', '大池小館', '啟欣苑零售大樓 1/F（沐禮街6號）', '點心店。', 'Dim sum restaurant.'),
  mkR('r-ky-sangatsu', 'kaiyan', 'western', '三月見', '三月見', '啟欣苑零售大樓 G/F（沐禮街6號）', '西餐廳。', 'Western restaurant.'),
  mkR('r-ky-cheungheung', 'kaiyan', 'hkcafe', '祥香園', '祥香園', '啟欣苑零售大樓 G/F（沐禮街6號）', '港式茶餐廳。', 'Hong Kong-style café.'),
  /* 新居屋：啟悅苑、啟盈苑（零售大樓已落成或即將啟用，個別食肆未能核實） */
  mkR('dn-kaiyuet', 'kaiyuet', 'area', '啟悅苑零售大樓', 'Kai Yuet Court retail block', '沐和街2號', '2025 年入伙居屋，設兩層高零售大樓；暫未能核實個別食肆，撳導航可在 Google 地圖查看最新食肆。', 'HOS court completed in 2025 with a two-storey retail block. Individual eateries are not yet verified; use the map to check.'),
  mkR('dn-kaiying', 'kaiying', 'area', '啟盈苑零售大樓', 'Kai Ying Court retail block', '沐和街6號', '2026 年入伙居屋，設零售大樓；暫未能核實個別食肆，撳導航可在 Google 地圖查看最新食肆。', 'HOS court completing in 2026 with a retail block. Individual eateries are not yet verified; use the map to check.'),

  /* 沐泰街／沐寧街私人屋苑地舖（D 出口） */
  mkR('r-mt-root', 'muktai', 'cafe', '根', 'Root Café', 'Parkside At The Henley 零售區1座 G/F 4號舖（沐泰街7號）', 'MIRROR 成員柳應廷開設的植物主題 Cafe，主打西餐及造型甜品。', 'Plant-themed café opened by MIRROR member Jer Lau, serving Western dishes and creative desserts.', { q: 'The Henley' }),
  mkR('r-mt-noc', 'muktai', 'cafe', 'NOC Coffee Co.', 'NOC Coffee Co.', 'THE HENLEY Retail 二期 G/F F&B 1 及 1/F F&B 5（沐泰街7號）', '太空主題精品咖啡店。', 'Space-themed specialty coffee shop.', { q: 'The Henley' }),
  mkR('r-ky-goodday', 'muktai', 'cafe', 'GoodDay Solar', 'GoodDay Solar', '嘉峯匯商舖 1/F 11號舖', '水泥風日光 Cafe；營業時間 08:30–21:15。', 'Sunny industrial-style café; open 08:30–21:15.', { exit: 'D', q: '嘉峯匯' }),
  mkR('r-ot-fairwood', 'muktai', 'fastfood', '大快活', 'Fairwood', '啟德1號(II) 1/F A舖（沐寧街8號）', '港式連鎖快餐。', 'Hong Kong fast-food chain.', { exit: 'D', q: '啟德1號' }),
  mkR('r-ky-711', 'muktai', 'conv', '7-Eleven', '7-Eleven', '啟德1號(II) G/F 08–09號舖（沐寧街8號）', '便利店，提供飲品、輕食及微波食品。', 'Convenience store with drinks, snacks and ready meals.', { exit: 'D', q: '啟德1號' }),

  /* 其他 */
  mkR('r-ot-lstbakery', 'lph', 'bakery', '啟德社區廚房（樂善堂）', 'Lok Sin Tong Kai Tak Community Kitchen', '世運道簡約公屋第6座 G/F', '社企餅店及咖啡室。', 'Social-enterprise bakery and café.'),
  mkR('r-ot-charsiu', 'other', 'hkcafe', '叉燒丼家', 'The Master of Char Siu', '景福街99–101號啟德工廠大廈二期 G/F', '叉燒飯專門店。', 'Char siu rice specialist.', 'B1/B2'),
  mkR('dn-uplace', 'muktai', 'area', 'U PLACE Riverside 餐飲', 'U PLACE Riverside dining', '', '沿啟德河畔商場的餐飲選擇。', 'Riverside dining by the Kai Tak River.', { q: 'U PLACE Riverside' }),
  /* 🌊 啟德跑道區／承豐道（由啟德站 A 出口轉乘巴士） */
  mkR('r-rw-origami', 'runway', 'chinese', '紙飛機親子空間', 'Origami Kids Cafe', '啟德郵輪碼頭 B 區北面頂層平台（承豐道33號）', '全港首間主打中菜（江浙菜）的親子餐廳，設近 20 萬呎戶外平台公園；10:00–20:00，小童遊樂區另收入場費。', 'Hong Kong\'s first Chinese (Jiangzhe) family restaurant, next to a huge rooftop park; 10:00–20:00, kids\' play area charged separately.', { transfer: TRANSFER_CRUISE }),
  mkR('r-rw-oldhangar', 'runway', 'western', 'The Old Hangar', 'The Old Hangar', '啟德郵輪碼頭 B 區 2/F N205（承豐道33號）', '樓底 5 米高的森林系玻璃屋餐廳，主打歐陸及 Fusion 菜，日間為 Café 時段；只接受 WhatsApp 預約。', 'Five-metre-high greenhouse-style restaurant with European and fusion dishes; café hours by day. WhatsApp bookings only.', { transfer: TRANSFER_CRUISE }),
  mkR('r-rw-myharbour', 'runway', 'bar', '海薈', 'My Harbour', '啟德郵輪碼頭 頂層花園 S302（承豐道33號）', '多國菜及酒吧，位於郵輪碼頭頂層花園。', 'International dishes and bar on the cruise terminal rooftop garden.', { transfer: TRANSFER_CRUISE }),
  mkR('dn-runway-res', 'runway', 'area', '跑道區屋苑地舖（維港1號／天瀧一帶）', 'Runway area estate shops (One Victoria / The Knightsbridge)', '承豐道沿線', '跑道區屋苑基座商舖的食肆暫未能核實；撳導航可在 Google 地圖查看最新食肆及便利店。', 'Eateries in the runway-area estate podiums are not yet verified; use the map to check the latest restaurants and convenience stores.'),
  mkR('dn-spk', 'other', 'area', '新蒲崗地道小店', 'San Po Kong local eateries', '', '工廈區內有不少平民食肆及地道小店。', 'Many affordable local eateries around the industrial buildings.', 'B1/B2'),

  /* ---------- 新增：銀行／自動櫃員機／外幣服務（2026 年 10 月網上搜尋核實，出發前請再向銀行確認） ---------- */
  mk('bk-hsbc-kt', 'bank', 'D', '滙豐 啟德分行（啟德零售館2 2樓 M2-211及212號舖）', 'HSBC Kai Tak Branch (Shop M2-211&212, Level 2, Kai Tak Mall 2)', '提供提款、存款、外幣兌換服務，並設可提取人民幣及外幣的自動櫃員機；同址設卓越理財中心。營業時間：星期一至五 09:00–17:00，星期六 09:00–13:00。', 'Cash withdrawal and deposit, foreign currency exchange, and an RMB / foreign currency ATM; HSBC Premier Centre at the same address. Mon–Fri 09:00–17:00, Sat 09:00–13:00.',
    ['D 出口前往啟德體育園啟德零售館2，上 2 樓。', 'From Exit D, go to Kai Tak Mall 2 at Kai Tak Sports Park, Level 2.'], 'HSBC Kai Tak Branch'),
  mk('bk-boc-kt', 'bank', 'C', '中國銀行(香港) 啟德分行（AIRSIDE 3樓 321及324號舖）', 'Bank of China (Hong Kong) Kai Tak Branch (Shop 321 & 324, 3/F, AIRSIDE)', '324 號舖為分行（星期一至五 09:00–17:00，星期六 09:00–13:00）；321 號舖為自助銀行中心，按商場開放時間開放，設提款機、存鈔機及存票機，並有外幣提款機。', 'Branch at Shop 324 (Mon–Fri 09:00–17:00, Sat 09:00–13:00). Self-service centre at Shop 321 follows mall hours, with ATMs, cash and cheque deposit machines, plus a foreign currency ATM.',
    ['C 出口直達 AIRSIDE，上 3 樓。', 'Exit C leads straight into AIRSIDE; go up to 3/F.'], '中國銀行 啟德分行 AIRSIDE'),
  mk('bk-icbc-kt', 'bank', 'C', '中國工商銀行（亞洲）啟德分行（AIRSIDE 1樓 L112號舖）', 'ICBC (Asia) Kai Tak Branch (Shop L112, 1/F, AIRSIDE)', '提供個人及商業銀行服務，設視像銀行及自助銀行服務。', 'Personal and commercial banking, with video banking and self-service banking.',
    ['C 出口直達 AIRSIDE，上 1 樓。', 'Exit C leads straight into AIRSIDE; go up to 1/F.'], 'ICBC Asia AIRSIDE Kai Tak'),
  {
    id: 'bk-ncb-kt', category: 'bank', exit: 'D',
    name: { zh: '南洋商業銀行 啟德分行（嘉峯匯地下1-3號舖）', en: 'Nanyang Commercial Bank Kai Tak Branch (Shop 1-3, G/F, K.Summit)', ko: '난양상업은행 카이탁 지점 (K.Summit G층 1-3호)', ja: '南洋商業銀行 啓徳支店（K.Summit 地下1-3号舗）' },
    desc: {
      zh: '設現金櫃檯服務及輪椅通道。地址：九龍啟德沐泰街9號嘉峯匯地下1-3號舖。電話：3982 9917。營業時間：星期一至五 09:00–17:00，星期六 09:00–13:00。',
      en: 'Cash counter service and wheelchair access. 9 Muk Tai Street, Kai Tak. Tel 3982 9917. Mon–Fri 09:00–17:00, Sat 09:00–13:00.',
      ko: '현금 창구 서비스 및 휠체어 접근 가능. 카이탁 무타이 스트리트 9번지. 전화 3982 9917. 월–금 09:00–17:00, 토 09:00–13:00.',
      ja: '現金窓口サービスあり、車椅子対応。啓徳 沐泰街9号。電話 3982 9917。月–金 09:00–17:00、土 09:00–13:00。',
    },
    tip: {
      zh: 'D 出口前往沐泰街嘉峯匯，分行位於地下。',
      en: 'From Exit D, head to K.Summit on Muk Tai Street. The branch is on the ground floor.',
      ko: 'D 출구에서 무타이 스트리트의 K.Summit으로 이동하세요. 지점은 G층에 있습니다.',
      ja: 'D出口から沐泰街の K.Summit へ。支店は地上階にあります。',
    },
    mapQuery: '南洋商業銀行 啟德分行',
  },
  mk('bk-ice-cruise', 'bank', 'A', 'ICE 貨幣兌換（啟德郵輪碼頭 G/F 出口大堂）', 'ICE Currency Exchange (G/F Exit Hall, Kai Tak Cruise Terminal)', '只於郵輪靠岸日子開放，營業時間請參閱櫃面（資料截至 2024 年，出發前請核實）。', 'Open only on cruise-ship days; check the counter for hours (as of 2024, please verify).', [TRANSFER_CRUISE.zh, TRANSFER_CRUISE.en], '啟德郵輪碼頭'),
  mk('bk-boc-atm-kat', 'bank', 'KAT', '中國銀行(香港) 自動櫃員機（啟德站閘外 KAT 6號舖）', 'Bank of China (Hong Kong) ATM (Shop KAT 6, Kai Tak Station, unpaid area)', '位於車站大堂閘外的自動櫃員機。', 'ATM in the station concourse, outside the gates.', null, '啟德站 中國銀行 自動櫃員機'),
  mk('bk-hangseng-kat', 'bank', 'KAT', '恒生銀行（啟德站大堂 KAT 7號舖）', 'Hang Seng Bank (Shop KAT 7, Kai Tak Station concourse)', '位於車站大堂。此項資料來自第三方網站，實際服務類型請向銀行核實。', 'In the station concourse. Listed by third-party sites; please check the service type with the bank.', null, '恒生銀行 啟德站'),
  mk('bk-boc-atm-chinglong', 'bank', 'A', '中國銀行(香港) 自動櫃員機（晴朗商場 A區 1樓）', 'Bank of China (Hong Kong) ATM (Zone A, 1/F, Ching Long Shopping Centre)', '晴朗商場內的自動櫃員機。', 'ATM inside Ching Long Shopping Centre.', null, '晴朗商場'),
  mk('bk-boc-atm-hkch', 'bank', 'D', '中國銀行(香港) 自動櫃員機（香港兒童醫院 B座地下）', "Bank of China (Hong Kong) ATM (G/F, Block B, Hong Kong Children's Hospital)", '香港兒童醫院內的自動櫃員機。', "ATM inside Hong Kong Children's Hospital.", null, '香港兒童醫院'),
  mk('bk-icbc-atm-mikiki', 'bank', 'C', '中國工商銀行（亞洲）自動櫃員機（MIKIKI 1樓）', 'ICBC (Asia) ATM (1/F, MIKIKI)', 'MIKIKI 商場內的自動櫃員機（資料截至 2023 年，出發前請核實）。', 'ATM inside MIKIKI (listed as of 2023; please check before going).', null, 'MIKIKI 新蒲崗'),
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

const r1 = (x) => Math.round(x * 10) / 10;
const halfUp = (x) => Math.ceil(x * 2) / 2;
// 「兩蚊兩折」（2026 年 4 月 3 日起）：成人車費 $10 或以下付 $2；高於 $10 付成人車費兩成
const twoTwo = (adult) => (adult <= 10 ? 2 : r1(adult * 0.2));

// 補齊各類乘客車費：官方數值優先，缺少的欄位按規則推算
function completeFare(f, source) {
  const oct = f.oct;
  const single = f.single ?? halfUp(oct * 1.1);
  const childOct = f.childOct ?? r1(oct / 2);
  const childSingle = f.childSingle ?? halfUp(single / 2);
  const elderOct = f.elderOct ?? r1(oct / 2);
  const elderSingle = f.elderSingle ?? childSingle;
  const joy60 = f.joy60 ?? twoTwo(oct);
  const joy65 = Math.min(joy60, elderOct); // 樂悠咭 65 歲或以上：兩蚊兩折與長者優惠取較低者（推算）
  return { oct, single, childOct, childSingle, elderOct, elderSingle, joy60, joy65, source };
}

function estimateFare(route) {
  const oct = r1(3.5 + 0.55 * Math.pow(route.rideMins, 0.85) + (route.cross ? 5 : 0));
  return { oct, single: halfUp(oct * 1.1) };
}

// 由啟德往某站（不含機場快綫）的車費：優先使用港鐵開放數據
function fareTo(code, fares) {
  const f = fares && fares[normName(ST[code][1])];
  if (f && f.oct != null) return completeFare(f, 'official');
  const r = routeTo(code);
  return r ? completeFare(estimateFare(r), 'estimate') : null;
}

function planTrip(dest, fares) {
  const route = routeTo(dest);
  if (!route) return null;
  const aelLeg = route.legs.find((l) => l.line === 'AEL');
  let fare;
  if (aelLeg) {
    // 港鐵開放數據不包括機場快綫：成人車費為估算，優惠車費請參閱官網
    const base = aelLeg.from === 'KAT' ? { oct: 0, single: 0, source: 'official' } : fareTo(aelLeg.from, fares);
    const extra = AEL_EST[aelLeg.from] || 100;
    fare = { oct: base.oct + extra, single: base.single + extra, childOct: null, childSingle: null, elderOct: null, elderSingle: null, joy60: null, joy65: null, source: base.source, ael: true };
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
  const idx = {
    oct: head.indexOf('OCT_ADT_FARE'), single: head.indexOf('SINGLE_ADT_FARE'),
    childOct: head.indexOf('OCT_CON_CHILD_FARE'), childSingle: head.indexOf('SINGLE_CON_CHILD_FARE'),
    elderOct: head.indexOf('OCT_CON_ELDERLY_FARE'), elderSingle: head.indexOf('SINGLE_CON_ELDERLY_FARE'),
    joy60: head.indexOf('OCT_JOYYOU_SIXTY_FARE'),
  };
  if (iS < 0 || iD < 0 || idx.oct < 0) return null;
  const out = {};
  for (let k = 1; k < rows.length; k++) {
    const c = rows[k].split(',').map((x) => x.replace(/"/g, '').trim());
    if (normName(c[iS]) !== 'kaitak') continue;
    const num = (i) => (i >= 0 && c[i] !== '' && !Number.isNaN(parseFloat(c[i])) ? parseFloat(c[i]) : null);
    out[normName(c[iD])] = Object.fromEntries(Object.entries(idx).map(([key, i]) => [key, num(i)]));
  }
  return Object.keys(out).length ? out : null;
}

const STATION_NAME = {
  WKS: { zh: '烏溪沙', en: 'Wu Kai Sha', ko: '우카이샤', ja: '烏溪沙' },
  TUM: { zh: '屯門', en: 'Tuen Mun', ko: '툰문', ja: '屯門' },
  TAW: { zh: '大圍', en: 'Tai Wai', ko: '타이와이', ja: '大圍' },
  HUH: { zh: '紅磡', en: 'Hung Hom', ko: '홍함', ja: '紅磡' },
};

/* ============================ 官方指南資料版本與差異同步 ============================ */
// 每次按港鐵新版《車站指南》更新 SEED 後，請同時更新此版本號
const DATA_VERSION = '港鐵啟德站指南 09/2026 + 2026-10 增補（第 9 版：跑道區）';
const isCustomId = (id) => String(id).startsWith('lm-'); // 管理員自行新增的地點，同步時保留
const normItem = (x) => JSON.stringify([x.category, x.exit, x.name, x.desc, x.tip, x.mapQuery, x.meta || null], (k, v) =>
  v && typeof v === 'object' && !Array.isArray(v) ? Object.keys(v).sort().reduce((o, key) => { o[key] = v[key]; return o; }, {}) : v);

// 比較雲端資料與最新官方資料：新增、修改、移除
function diffWithSeed(current) {
  const cur = new Map(current.map((x) => [x.id, x]));
  const seedIds = new Set(SEED.map((x) => x.id));
  const added = SEED.filter((s) => !cur.has(s.id));
  const changed = SEED.filter((s) => cur.has(s.id) && normItem(s) !== normItem(cur.get(s.id)));
  const removed = current.filter((x) => !isCustomId(x.id) && !seedIds.has(x.id));
  return { added, changed, removed, total: added.length + changed.length + removed.length };
}

// 套用同步：官方資料按 SEED 順序排列，自訂地點保留並排在後面
async function applySeedSync(current) {
  const custom = current.filter((x) => isCustomId(x.id));
  const next = [...SEED, ...custom];
  const { removed } = diffWithSeed(current);
  if (supabase) {
    const { error: e1 } = await supabase.from('landmarks').upsert(next.map(toRow));
    if (e1) throw e1;
    if (removed.length) {
      const { error: e2 } = await supabase.from('landmarks').delete().in('id', removed.map((x) => x.id));
      if (e2) throw e2;
    }
  }
  try { localStorage.setItem(LS_KEY, JSON.stringify(next)); } catch {}
  return next;
}
const hashItems = (list) => list.map((x) => x.id + normItem(x)).join('|');

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
/* Google 翻譯：改用原生下拉選單，由手機／瀏覽器自行顯示選項，不會超出畫面 */
#google_translate_element .goog-te-gadget{ font-size:0 !important; line-height:0; color:transparent !important; white-space:nowrap; }
#google_translate_element .goog-te-gadget > span, #google_translate_element .goog-logo-link{ display:none !important; }
#google_translate_element .goog-te-combo{ margin:0 !important; width:9.5rem; max-width:100%; font-size:13px; line-height:1.2; padding:6px 8px; border-radius:8px; border:1px solid rgba(255,255,255,.25); background:#223041; color:#fff; cursor:pointer; }
@media (max-width: 767px){ #google_translate_element .goog-te-combo{ width:7.25rem; } }
/* 隱藏 Google 翻譯頂部橫額及懸浮提示，避免頁面被推低或遮擋 */
.goog-te-banner-frame, iframe.skiptranslate, #goog-gt-tt, .goog-te-balloon-frame, .VIpgJd-ZVi9od-ORHb-OEVmcd, .VIpgJd-ZVi9od-aZ2wEe-wOHMyf, .VIpgJd-yAWNEb-L7lbkb{ display:none !important; }
body{ top:0 !important; position:static !important; }
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
          { pageLanguage: 'zh-TW', autoDisplay: false }, // 預設版面 = 原生下拉選單
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
    // 手機：標題一行、語言選項另起一行（不固定頂部，避免佔用畫面）；電腦：同一行並固定頂部
    <header className="relative z-30 md:sticky md:top-0" style={{ top: 'env(safe-area-inset-top, 0px)' }}>
      <div className="bg-[#16202B] text-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-3 px-4 py-3">
          {/* 標題（可自動換行，不會被裁切） */}
          <div className="order-1 flex min-w-0 flex-1 items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg" style={{ background: LINES.TML.color }}>
              <Train size={22} />
            </div>
            <div className="min-w-0">
              <h1 className="text-[15px] font-bold leading-snug sm:text-lg">{t.title}</h1>
              <p className="text-xs leading-snug text-white/60">Kai Tak Transit &amp; Landmark Guide</p>
            </div>
          </div>

          {/* 管理員按鈕：手機貼右上角，電腦放最右 */}
          <div className="order-2 shrink-0 self-start md:order-3 md:self-center">
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

          {/* 語言選項：手機佔滿整行，電腦跟標題同一行 */}
          <div className="order-3 flex w-full items-center gap-2 md:order-2 md:w-auto">
            <div className="grid flex-1 grid-cols-4 rounded-lg bg-white/10 p-0.5 md:flex md:flex-none" role="group" aria-label="Language">
              {LANGS.map((l) => (
                <button key={l.code} onClick={() => setLang(l.code)}
                  className={`relative whitespace-nowrap rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors md:py-1 ${lang === l.code ? 'text-[#16202B]' : 'text-white/75 hover:text-white'}`}>
                  {lang === l.code && <motion.span layoutId="langPill" className="absolute inset-0 rounded-md bg-white" transition={{ type: 'spring', damping: 30, stiffness: 400 }} />}
                  <span className="relative">{l.label}</span>
                </button>
              ))}
            </div>
            <div className="flex shrink-0 items-center gap-1" title={gt === 'error' ? t.gtFail : 'Google Translate'}>
              <Globe size={16} className="shrink-0 text-white/60" />
              <div id="google_translate_element" className={gt === 'ready' ? 'min-w-0' : 'hidden'} />
              {gt !== 'ready' && <span className="hidden text-[11px] text-white/45 lg:inline">{gt === 'error' ? 'Google' : '…'}</span>}
            </div>
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
      {HOSPITAL_IDS.has(item.id) && <HospitalGuide t={t} lang={lang} />}
      {!HOSPITAL_IDS.has(item.id) && etaTargetOf(item) && <TransitEtaBadges targetKey={etaTargetOf(item)} t={t} lang={lang} />}
      <div className="mt-auto pt-3.5">
        <a href={mapsUrl(item.mapQuery || item.name.zh)} target="_blank" rel="noopener noreferrer"
          className="flex items-center justify-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-2 text-sm font-semibold transition-colors hover:border-[var(--ink)]">
          <Navigation size={15} />{t.navigate}
        </a>
      </div>
    </motion.article>
  );
}

/* ---------- 美食搜尋：菜式大類及關鍵字 ---------- */
// 篩選標籤用的食肆種類（按乘客常用的找食方式分組）
const CUISINE_GROUPS = [
  { id: 'fast', cuisines: ['fastfood', 'conv'], label: { zh: '連鎖快餐', en: 'Fast food', ko: '패스트푸드', ja: 'ファストフード' } },
  { id: 'hk', cuisines: ['hkcafe'], label: { zh: '港式／茶餐廳', en: 'HK café', ko: '홍콩식 식당', ja: '香港式喫茶' } },
  { id: 'jpkr', cuisines: ['japanese', 'ramen', 'bbq', 'korean'], label: { zh: '日式／韓式', en: 'Japanese & Korean', ko: '일식·한식', ja: '和食・韓国料理' } },
  { id: 'west', cuisines: ['western', 'fusion', 'cafe'], label: { zh: '西式／CAFE', en: 'Western & café', ko: '양식·카페', ja: '洋食・カフェ' } },
  { id: 'sweet', cuisines: ['drinks', 'dessert', 'bakery'], label: { zh: '茶飲／甜品', en: 'Drinks & desserts', ko: '음료·디저트', ja: 'ドリンク・スイーツ' } },
  { id: 'cn', cuisines: ['chinese', 'sea'], label: { zh: '中菜／亞洲', en: 'Chinese & Asian', ko: '중식·아시아', ja: '中華・アジア' } },
  { id: 'bar', cuisines: ['bar'], label: { zh: '酒吧／Sports Bar', en: 'Bars', ko: '바', ja: 'バー' } },
  { id: 'hotpot', cuisines: ['hotpot'], label: { zh: '火鍋', en: 'Hotpot', ko: '훠궈', ja: '鍋料理' } },
  { id: 'court', cuisines: ['foodcourt', 'area'], label: { zh: '美食廣場／美食區', en: 'Food courts & areas', ko: '푸드코트·식당가', ja: 'フードコート・飲食エリア' } },
];
const groupOf = (cuisine) => CUISINE_GROUPS.find((g) => g.cuisines.includes(cuisine));
// 區域篩選標籤：每個標籤包含一組商場／屋苑
const AREA_TABS = [
  { id: 'core', malls: ['airside', 'twins', 'cullinan', 'kat'], label: { zh: '🛒 AIRSIDE / 雙子匯', en: '🛒 AIRSIDE / The Twins', ko: '🛒 AIRSIDE / 더 트윈스', ja: '🛒 AIRSIDE / The Twins' } },
  { id: 'ktsp', malls: ['ktsp'], label: { zh: '🏟️ 體育園 / 啟德零售館', en: '🏟️ Sports Park / Kai Tak Mall', ko: '🏟️ 스포츠파크 / 카이탁 몰', ja: '🏟️ スポーツパーク／啓徳モール' } },
  { id: 'estates', malls: ['kaiyuet', 'kaiying', 'kaiyan', 'chinglong', 'lph'], label: { zh: '🏠 啟悅/啟陽/啟欣/晴朗', en: '🏠 Public housing & HOS courts', ko: '🏠 공공주택 단지', ja: '🏠 公営住宅エリア' } },
  { id: 'runway', malls: ['runway'], label: { zh: '🌊 跑道區/承豐道海景餐飲', en: '🌊 Runway area / waterfront', ko: '🌊 활주로 지구·해변', ja: '🌊 ランウェイ地区・海辺' } },
  { id: 'muktai', malls: ['muktai'], label: { zh: '☕ 沐泰街屋苑地舖', en: '☕ Muk Tai Street shops', ko: '☕ 묵타이 스트리트', ja: '☕ 沐泰街の店舗' } },
  { id: 'mikiki', malls: ['mikiki'], label: { zh: '🏬 Mikiki', en: '🏬 Mikiki', ko: '🏬 Mikiki', ja: '🏬 Mikiki' } },
  { id: 'other', malls: ['other'], label: { zh: '其他', en: 'Others', ko: '기타', ja: 'その他' } },
];
// 菜式關鍵字：令「快餐」「茶餐廳」「CAFE」「拉麵」等常用字都搜尋得到
const CUISINE_TAGS = {
  fastfood: ['快餐', 'fast food', 'fastfood', '連鎖', 'chain'],
  hkcafe: ['茶餐廳', '冰室', '冰廳', '港式', 'hong kong style', 'cha chaan teng', '粉麵', '車仔麵', '粥'],
  japanese: ['日本菜', '日式', 'japanese', '和食'],
  ramen: ['拉麵', 'ラーメン', 'ramen', '烏冬', 'udon', 'noodle'],
  bbq: ['燒肉', '焼肉', 'yakiniku', 'bbq', '燒烤'],
  hotpot: ['火鍋', 'hotpot', '涮涮鍋', 'shabu', '打邊爐'],
  korean: ['韓國', '韓式', 'korean'],
  chinese: ['中菜', '中式', 'chinese', '台灣', 'taiwanese'],
  sea: ['泰國', '泰菜', 'thai', '東南亞', 'southeast asian'],
  western: ['西餐', '西式', 'western'],
  fusion: ['fusion', '創意', '新派'],
  cafe: ['cafe', 'café', 'coffee', '咖啡'],
  dessert: ['甜品', 'dessert', '輕食', 'snack'],
  drinks: ['茶飲', '飲品', 'drinks', '手搖', '奶茶', 'bubble tea', '涼茶'],
  bakery: ['餅店', '麵包', '西餅', 'bakery', '蛋糕', 'cake', '烘焙'],
  foodcourt: ['美食廣場', 'food court', 'foodcourt'],
  area: ['美食區', '食肆', 'eateries'],
  bar: ['酒吧', 'bar', 'sports bar', '運動酒吧', '睇波', '雞尾酒', 'cocktail', '啤酒', 'beer'],
  conv: ['便利店', 'convenience', '輕食', 'snack', '7-eleven', '711'],
};
const fold = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/寿/g, '壽');
// 美食搜尋評分：餐廳名稱 > 菜式／關鍵字 > 特色介紹 > 商場；出口號碼不作搜尋依據
function diningScore(it, k) {
  const m = it.meta || {};
  const name = fold(Object.values(it.name || {}).join(' '));
  const tags = fold([...(m.cuisine && CUISINES[m.cuisine] ? Object.values(CUISINES[m.cuisine]) : []), ...(CUISINE_TAGS[m.cuisine] || [])].join(' '));
  const desc = fold(Object.values(it.desc || {}).join(' '));
  const place = fold([...(m.mall && MALLS[m.mall] ? Object.values(MALLS[m.mall].label) : []), ...(m.floor ? Object.values(m.floor) : [])].join(' '));
  if (name.startsWith(k)) return 5;
  if (name.includes(k)) return 4;
  if (tags.includes(k)) return 3;
  if (desc.includes(k)) return 2;
  if (place.includes(k)) return 1;
  return 0;
}

function RestaurantCard({ item, lang, t, isAdmin, onEdit, onDelete }) {
  const meta = item.meta || {};
  const mall = MALLS[meta.mall] || MALLS.other;
  const cuisine = CUISINES[meta.cuisine] || CUISINES.area;
  const floor = meta.floor ? tx(meta.floor, lang) : '';
  const walk = meta.transfer ? '' : walkText(item.exit, meta.walk, lang, meta.note);
  const transfer = meta.transfer ? tx(meta.transfer, lang) : '';
  const title = tx(item.name, lang);
  const sub = [item.name.zh, item.name.en].filter((n) => n && n !== title)[0];
  return (
    <motion.article layout initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} transition={{ duration: 0.2 }}
      className="relative flex flex-col rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
      {isAdmin && (
        <div className="absolute right-2 top-2 flex gap-1">
          <button onClick={() => onEdit(item)} aria-label={t.edit} className="rounded-md bg-[var(--surface-2)] p-1.5 hover:bg-[var(--border)]"><Pencil size={12} /></button>
          <button onClick={() => onDelete(item)} aria-label={t.del} className="rounded-md bg-red-600 p-1.5 text-white hover:bg-red-700"><Trash2 size={12} /></button>
        </div>
      )}
      {/* 主標題：餐廳名稱 + 菜式 */}
      <div className={isAdmin ? 'pr-16' : ''}>
        <h3 className="text-lg font-bold leading-snug">{title}</h3>
        {sub && <p className="text-sm text-[var(--muted)]">{sub}</p>}
        {(() => {
          const g = groupOf(meta.cuisine);
          const gl = g ? tx(g.label, lang) : tx(cuisine, lang);
          const cl = tx(cuisine, lang);
          return (
            <span className="mt-2 inline-flex flex-wrap items-center gap-1.5">
              <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold" style={{ background: 'var(--tml-soft)', color: 'var(--tml)' }}>
                <UtensilsCrossed size={12} />{gl}
              </span>
              {cl !== gl && <span className="text-xs font-medium text-[var(--muted)]">{cl}</span>}
            </span>
          );
        })()}
      </div>
      <p className="mt-2.5 text-sm leading-relaxed">{tx(item.desc, lang)}</p>
      {/* 輔助資料：出口、商場及樓層 */}
      <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-[var(--border)] pt-3 text-[11px] text-[var(--muted)]">
        <span className="inline-flex items-center gap-1 rounded-md bg-[var(--surface-2)] py-0.5 pl-0.5 pr-2 font-semibold text-[var(--ink)]">
          <ExitPlate exit={item.exit} />{item.exit === 'KAT' ? t.concourse : `${t.exit} ${item.exit}`}
        </span>
        <span className="inline-flex items-center gap-1 rounded-md bg-[var(--surface-2)] px-2 py-1 font-semibold text-[var(--ink)]">
          <MapPin size={11} />{tx(mall.label, lang)}{floor ? ` · ${floor}` : ''}
        </span>
        {walk && <span className="inline-flex items-center gap-1 px-1"><Footprints size={11} />{walk}</span>}
        {transfer && (
          <span className="flex w-full items-start gap-1.5 rounded-md px-2 py-1.5 font-semibold" style={{ background: 'var(--warn-bg)', color: 'var(--warn-ink)' }}>
            <Bus size={12} className="mt-0.5 shrink-0" />{transfer}
          </span>
        )}
      </div>
      {etaTargetOf(item) && <TransitEtaBadges targetKey={etaTargetOf(item)} t={t} lang={lang} />}
      <div className="mt-auto pt-3.5">
        <a href={mapsUrl(item.mapQuery || `${item.name.zh} 啟德`)} target="_blank" rel="noopener noreferrer"
          className="flex items-center justify-center gap-1.5 rounded-lg px-3 py-2.5 text-sm font-bold text-white transition-opacity hover:opacity-90" style={{ background: LINES.TML.color }}>
          📍 {t.navigate}<ExternalLink size={14} />
        </a>
      </div>
    </motion.article>
  );
}

function LandmarkPortal({ items, lang, t, isAdmin, onAdd, onEdit, onDelete, onRoute }) {
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('all');
  const [mallF, setMallF] = useState('all');
  const [groupF, setGroupF] = useState('all');

  const filtered = useMemo(() => {
    const k = q.trim().toLowerCase();
    // 美食餐飲：以餐廳名稱／菜式為搜尋主題，按相關度排序
    if (cat === 'dining') {
      const group = CUISINE_GROUPS.find((g) => g.id === groupF);
      const fk = fold(k);
      return items
        .filter((it) => it.category === 'dining')
        .filter((it) => mallF === 'all' || ((AREA_TABS.find((a) => a.id === mallF) || { malls: [] }).malls.includes((it.meta || {}).mall)))
        .filter((it) => !group || group.cuisines.includes((it.meta || {}).cuisine))
        .map((it) => ({ it, s: fk ? diningScore(it, fk) : 1 }))
        .filter((x) => x.s > 0)
        .sort((a, b) => b.s - a.s)
        .map((x) => x.it);
    }
    return items.filter((it) => {
      if (cat !== 'all' && it.category !== cat) return false;
      if (!k) return true;
      const m = it.meta || {};
      const hay = [
        ...Object.values(it.name || {}), ...Object.values(it.desc || {}), ...Object.values(it.tip || {}),
        it.exit, `exit ${it.exit}`, `${it.exit} 出口`, it.mapQuery, ...Object.values(catById(it.category).label),
        ...(m.mall && MALLS[m.mall] ? Object.values(MALLS[m.mall].label) : []),
        ...(m.cuisine && CUISINES[m.cuisine] ? Object.values(CUISINES[m.cuisine]) : []),
        ...(m.floor ? Object.values(m.floor) : []),
      ].join(' ').toLowerCase();
      // 單獨輸入出口代號（如 "c"、"b1"）時，精確比對出口
      if (/^(exit\s*)?[a-d]\d?$/i.test(k)) return it.exit.toLowerCase().split('/').includes(k.replace(/exit\s*/i, ''));
      return hay.includes(k);
    });
  }, [items, q, cat, mallF, groupF]);

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
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={cat === 'dining' ? t.searchDining : t.searchPh}
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

      {cat === 'bank' && <div className="mt-4"><MoneyExchangeFinder t={t} lang={lang} items={items} onRoute={onRoute} /></div>}
      {cat === 'dining' && (() => {
        const dining = items.filter((x) => x.category === 'dining');
        const groupCount = (g) => dining.filter((x) => g.cuisines.includes((x.meta || {}).cuisine)).length;
        const areaCount = (a) => dining.filter((x) => a.malls.includes((x.meta || {}).mall)).length;
        const Chip = ({ active, onClick, children, big }) => (
          <button onClick={onClick} className={`whitespace-nowrap rounded-full border font-semibold transition-colors ${big ? 'px-3.5 py-1.5 text-sm' : 'px-3 py-1 text-xs'} ${active ? 'border-transparent text-white' : 'border-[var(--border)] bg-[var(--surface)] hover:border-[var(--ink)]'}`}
            style={active ? { background: LINES.TML.color } : undefined}>{children}</button>
        );
        return (
          <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="mt-3 space-y-2.5 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
            <div className="-mx-3 flex items-center gap-2 overflow-x-auto px-3 pb-0.5">
              <span className="shrink-0 text-xs font-bold text-[var(--muted)]">{t.dCuisine}</span>
              <Chip big active={groupF === 'all'} onClick={() => setGroupF('all')}>{t.dAllCuisine}</Chip>
              {CUISINE_GROUPS.filter((g) => groupCount(g)).map((g) => (
                <Chip big key={g.id} active={groupF === g.id} onClick={() => setGroupF(g.id)}>{tx(g.label, lang)} <span className="opacity-70">{groupCount(g)}</span></Chip>
              ))}
            </div>
            <div className="-mx-3 flex items-center gap-2 overflow-x-auto px-3 pb-0.5">
              <span className="shrink-0 text-xs font-bold text-[var(--muted)]">{t.dArea}</span>
              <Chip active={mallF === 'all'} onClick={() => setMallF('all')}>{t.dAllArea}</Chip>
              {AREA_TABS.filter((a) => areaCount(a)).map((a) => (
                <Chip key={a.id} active={mallF === a.id} onClick={() => setMallF(a.id)}>{tx(a.label, lang)} <span className="opacity-70">{areaCount(a)}</span></Chip>
              ))}
            </div>
            <p className="text-[11px] text-[var(--muted)]">{t.walkNote}</p>
          </motion.div>
        );
      })()}
      <p className="mt-3 text-sm text-[var(--muted)]">{fmt(t.count, { n: filtered.length })}</p>

      {filtered.length === 0 ? (
        <div className="mt-6 rounded-xl border border-dashed border-[var(--border)] p-8 text-center">
          <p className="text-sm text-[var(--muted)]">{t.noResult}</p>
          <button onClick={() => { setQ(''); setCat('all'); setMallF('all'); setGroupF('all'); }} className="mt-3 rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm font-medium hover:border-[var(--ink)]">{t.clear}</button>
        </div>
      ) : (
        <motion.div layout className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <AnimatePresence mode="popLayout">
            {filtered.map((it) => (
              it.category === 'dining' && it.meta
                ? <RestaurantCard key={it.id} item={it} lang={lang} t={t} isAdmin={isAdmin} onEdit={onEdit} onDelete={onDelete} />
                : <LandmarkCard key={it.id} item={it} lang={lang} t={t} isAdmin={isAdmin} onEdit={onEdit} onDelete={onDelete} />
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

function StationRouteFinder({ t, lang, fares, fareStatus, initialDest }) {
  const [line, setLine] = useState('ALL');
  const [q, setQ] = useState('');
  const [dest, setDest] = useState(initialDest || 'CEN');
  useEffect(() => { if (initialDest) { setDest(initialDest); setLine('ALL'); setQ(''); } }, [initialDest]);

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
                <div className="overflow-hidden rounded-xl border border-[var(--border)]">
                  <table className="w-full text-sm">
                    <thead className="bg-[var(--surface-2)] text-xs text-[var(--muted)]">
                      <tr>
                        <th className="px-3 py-2 text-left font-medium">{t.fareType}</th>
                        <th className="px-3 py-2 text-right font-medium">{t.octCol}</th>
                        <th className="px-3 py-2 text-right font-medium">{t.singleCol}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[
                        { k: t.fAdult, oct: fare && fare.oct, single: fare && fare.single, strong: true },
                        { k: t.fChild, oct: fare && fare.childOct, single: fare && fare.childSingle },
                        { k: t.fElder, oct: fare && fare.elderOct, single: fare && fare.elderSingle },
                        { k: t.fJoy60, oct: fare && fare.joy60, single: null },
                        { k: `${t.fJoy65} *`, oct: fare && fare.joy65, single: null },
                      ].map((r) => (
                        <tr key={r.k} className="border-t border-[var(--border)]">
                          <td className={`px-3 py-2 ${r.strong ? 'font-bold' : ''}`}>{r.k}</td>
                          <td className={`num px-3 py-2 text-right ${r.strong ? 'text-2xl font-bold' : 'text-base font-semibold'}`}>{money(r.oct)}</td>
                          <td className={`num px-3 py-2 text-right ${r.strong ? 'text-lg font-bold' : 'text-base font-semibold'} text-[var(--muted)]`}>{money(r.single)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="flex items-baseline justify-between rounded-lg bg-[var(--surface-2)] px-4 py-3">
                  <span className="text-sm text-[var(--muted)]">{t.time}<span className="block text-[11px]">{t.timeNote}</span></span>
                  <span className="num text-xl font-bold">{plan.mins} {t.mins}</span>
                </div>
                <div className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold ${fare && fare.source === 'official' ? 'bg-emerald-100 text-emerald-800' : ''}`}
                  style={fare && fare.source === 'official' ? undefined : { background: 'var(--warn-bg)', color: 'var(--warn-ink)' }}>
                  <Database size={14} />
                  {fareStatus === 'loading' ? t.fareLoading : fare && fare.source === 'official' ? t.fareOfficial : t.fareEstimate}
                </div>
                {fare && fare.ael && <p className="text-xs text-[var(--warn-ink)]">{t.aelNote} {t.aelConcession}</p>}
                <div className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold" style={{ background: 'var(--tml-soft)', color: 'var(--tml)' }}>
                  <Ticket size={14} />{plan.pass === 'free' ? t.passFree : t.passDisc}
                </div>
                <div className="space-y-1 text-xs leading-relaxed text-[var(--muted)]">
                  <p>{t.joyNote}</p>
                  <p>* {t.joy65Note}</p>
                  <p>{t.fareNote}</p>
                </div>
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
    { key: 'oct', title: '實體八達通卡', warn: '啟德站現場不設實體八達通卡發售',
      body: ['如需購買，請前往設有完整客務中心櫃枱的車站（如鑽石山站或何文田站）。', '旅客亦可改用手機八達通（Mobile Octopus），直接於手機開卡及增值。'] },
    { key: 'mp', title: '全月通 加強版（尖東 – 烏溪沙）', flag: '啟德站位處本全月通指定覆蓋範圍內！',
      body: ['有效月份內無限次免費乘搭屯馬綫尖東至烏溪沙段（包括啟德、鑽石山、紅磡等站）。', '連接指定範圍以外的路程（例如過海往金鐘、中環），正價車費可享 75 折（25% OFF）優惠。', '可於啟德站自動售票機購買。'] },
    { key: 'cs', title: '港鐵都會票（MTR City Saver）', warn: '啟德站客務中心不設發售',
      body: ['40 天內可乘搭 40 程指定市區綫車程。', '啟德站現場只可於自動售票機購買；亦可前往其他設有完整客務中心櫃枱的車站（如鑽石山站、何文田站）購買。'] },
    { key: 'tdp', title: '遊客全日通（Tourist Day Pass）', warn: '啟德站現場不設發售',
      body: ['必須前往設有完整客務中心櫃枱的車站（如鑽石山站、何文田站等）方可購買。', '購票後可於啟德站正常感應入閘使用。'] },
  ],
  en: [
    { key: 'oct', title: 'Physical Octopus Card', warn: 'Physical Octopus cards are not sold at Kai Tak Station',
      body: ['Buy one at a station with a full Customer Service Centre counter, such as Diamond Hill or Ho Man Tin.', 'Visitors can also use Mobile Octopus, which is issued and topped up on the phone.'] },
    { key: 'mp', title: 'Monthly Pass Extra (East TST – Wu Kai Sha)', flag: "Kai Tak is inside this pass's coverage zone!",
      body: ['Unlimited free rides on the Tuen Ma Line between East Tsim Sha Tsui and Wu Kai Sha (incl. Kai Tak, Diamond Hill, Hung Hom) during the valid month.', 'Journeys beyond the zone (e.g. cross-harbour to Admiralty or Central) get 25% off the regular fare.', 'Available from the ticket machines at Kai Tak.'] },
    { key: 'cs', title: 'MTR City Saver', warn: 'Not sold at the Kai Tak Customer Service Centre',
      body: ['40 rides on designated urban line journeys within 40 days.', 'At Kai Tak, buy it only from the ticket machines, or at other stations with a full Customer Service Centre counter (e.g. Diamond Hill, Ho Man Tin).'] },
    { key: 'tdp', title: 'Tourist Day Pass', warn: 'Not sold at Kai Tak Station',
      body: ['Buy it at a station with a full Customer Service Centre counter, such as Diamond Hill or Ho Man Tin.', 'Once bought, tap in at Kai Tak as normal.'] },
  ],
  ko: [
    { key: 'oct', title: '실물 옥토퍼스 카드', warn: '카이탁역에서는 실물 옥토퍼스 카드를 판매하지 않습니다',
      body: ['구매하려면 고객서비스센터 창구가 있는 역(다이아몬드힐역, 호만틴역 등)을 이용하세요.', '여행객은 휴대폰에서 바로 발급·충전하는 모바일 옥토퍼스(Mobile Octopus)도 이용할 수 있습니다.'] },
    { key: 'mp', title: '월정액 패스 엑스트라 (이스트 침사추이 – 우카이샤)', flag: '카이탁역은 이 패스의 적용 구간에 포함됩니다!',
      body: ['유효 월 동안 툰마선 이스트 침사추이–우카이샤 구간(카이탁, 다이아몬드힐, 홍함 포함) 무제한 무료 탑승.', '구간 밖으로 이어지는 이동(예: 애드미럴티·센트럴)은 정상 요금의 25% 할인.', '카이탁역 자동발매기에서 구매 가능.'] },
    { key: 'cs', title: 'MTR 시티 세이버 (MTR City Saver)', warn: '카이탁역 고객서비스센터에서는 판매하지 않습니다',
      body: ['40일 이내 지정 시내 노선 40회 탑승.', '카이탁역에서는 자동발매기에서만 구매 가능하며, 고객서비스센터 창구가 있는 다른 역(다이아몬드힐역, 호만틴역 등)에서도 구매할 수 있습니다.'] },
    { key: 'tdp', title: '관광객 1일권 (Tourist Day Pass)', warn: '카이탁역에서는 판매하지 않습니다',
      body: ['고객서비스센터 창구가 있는 역(다이아몬드힐역, 호만틴역 등)에서 구매해야 합니다.', '구매 후 카이탁역에서 평소처럼 개찰구를 통과하면 됩니다.'] },
  ],
  ja: [
    { key: 'oct', title: '実物のオクトパスカード', warn: '啓徳駅では実物のオクトパスカードを販売していません',
      body: ['購入はカスタマーサービスセンター窓口のある駅（鑽石山駅、何文田駅など）で。', '旅行者はスマホで発行・チャージできるモバイルオクトパス（Mobile Octopus）も利用できます。'] },
    { key: 'mp', title: '全月通 加強版（尖東 – 烏溪沙）', flag: '啓徳駅はこの定期券の対象区間内です！',
      body: ['有効月内は屯馬線 尖東–烏溪沙 区間（啓徳・鑽石山・紅磡など）が乗り放題。', '区間外へ続く乗車（例：金鐘・中環）は通常運賃の25%割引。', '啓徳駅の自動券売機で購入可能。'] },
    { key: 'cs', title: 'MTR 都会票（MTR City Saver）', warn: '啓徳駅のカスタマーサービスセンターでは販売なし',
      body: ['40日以内に指定の市街地路線を40回乗車可能。', '啓徳駅では自動券売機でのみ購入可能。窓口のある他の駅（鑽石山駅、何文田駅など）でも購入できます。'] },
    { key: 'tdp', title: '旅遊全日通（Tourist Day Pass）', warn: '啓徳駅では販売していません',
      body: ['カスタマーサービスセンター窓口のある駅（鑽石山駅、何文田駅など）で購入してください。', '購入後は啓徳駅で通常通り改札を通過できます。'] },
  ],
};

function TicketZone({ t, lang }) {
  const list = TICKETS[lang] || TICKETS.en;
  return (
    <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-5">
      <h2 className="flex items-center gap-2 text-lg font-bold"><Ticket size={19} />{t.tickets}</h2>
      <div className="mt-3 flex items-start gap-2 rounded-xl border-2 px-4 py-3 text-sm font-bold" style={{ background: 'var(--warn-bg)', color: 'var(--warn-ink)', borderColor: 'var(--sign)' }}>
        <AlertTriangle size={18} className="mt-0.5 shrink-0" />{t.octBanner}
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
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

      <div className="mt-4 rounded-xl border border-[var(--border)] p-4">
        <h3 className="flex items-center gap-2 text-sm font-bold"><Ticket size={16} />{t.tvmTitle}</h3>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <div className="rounded-lg bg-[var(--surface-2)] p-3">
            <p className="text-xs font-semibold text-[var(--muted)]">{t.tvmFuncLabel}</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {t.tvmFuncs.map((f) => <span key={f} className="rounded-full bg-[var(--surface)] px-2.5 py-1 text-xs font-semibold">{f}</span>)}
            </div>
          </div>
          <div className="rounded-lg p-3" style={{ background: 'var(--warn-bg)', color: 'var(--warn-ink)' }}>
            <p className="text-xs font-semibold">{t.tvmPayLabel}</p>
            <p className="mt-2 text-sm font-bold">{t.tvmPayOk}</p>
            <p className="mt-1 text-xs">{t.tvmPayNo}</p>
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-3 rounded-xl bg-[var(--surface-2)] p-4 sm:grid-cols-[1fr_auto] sm:items-center">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-bold"><Info size={16} />{t.service}</h3>
          <p className="mt-2 flex items-start gap-2 text-sm"><Info size={16} className="mt-0.5 shrink-0 text-[var(--muted)]" /><span>{t.csc}</span></p>
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
function MTRGuide({ t, lang, initialDest }) {
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
      <StationRouteFinder t={t} lang={lang} fares={fares} fareStatus={fareStatus} initialDest={initialDest} />
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
  meta: { mall: 'airside', cuisine: 'japanese', floor: { zh: '', en: '', ko: '', ja: '' }, walk: '' },
});

function LandmarkForm({ open, onClose, initial, onSave, t, lang }) {
  const [f, setF] = useState(emptyForm());
  const [tab, setTab] = useState('zh');
  const [err, setErr] = useState('');
  useEffect(() => {
    if (open) {
      const base = emptyForm();
      setF(initial ? {
        ...base, ...initial, name: { ...base.name, ...initial.name }, desc: { ...base.desc, ...initial.desc }, tip: { ...base.tip, ...initial.tip },
        meta: { ...base.meta, ...(initial.meta || {}), floor: { ...base.meta.floor, ...((initial.meta || {}).floor || {}) } },
      } : base);
      setTab('zh'); setErr('');
    }
  }, [open, initial]);

  const setL = (field, v) => setF((p) => ({ ...p, [field]: { ...p[field], [tab]: v } }));
  const submit = () => {
    if (!f.name.zh.trim() || !f.exit.trim()) { setErr(t.required); return; }
    const { meta, ...rest } = f;
    onSave({ ...rest, ...(f.category === 'dining' ? { meta } : {}), id: f.id || `lm-${Date.now()}`, mapQuery: f.mapQuery.trim() || f.name.zh.trim() });
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
        {f.category === 'dining' && (
          <div className="grid gap-3 rounded-lg border border-dashed border-[var(--border)] p-3 sm:grid-cols-2">
            <label className="block text-sm font-medium">{t.fMall}
              <select className={`${inputCls} mt-1`} value={f.meta.mall} onChange={(e) => setF({ ...f, meta: { ...f.meta, mall: e.target.value } })}>
                {Object.keys(MALLS).map((m) => <option key={m} value={m}>{tx(MALLS[m].label, lang)}</option>)}
              </select>
            </label>
            <label className="block text-sm font-medium">{t.fCuisine}
              <select className={`${inputCls} mt-1`} value={f.meta.cuisine} onChange={(e) => setF({ ...f, meta: { ...f.meta, cuisine: e.target.value } })}>
                {Object.keys(CUISINES).map((c) => <option key={c} value={c}>{tx(CUISINES[c], lang)}</option>)}
              </select>
            </label>
            <label className="block text-sm font-medium">{t.fFloor}
              <input className={`${inputCls} mt-1`} value={f.meta.floor[tab] || ''} placeholder="例如：3/F L301" onChange={(e) => setF({ ...f, meta: { ...f.meta, floor: { ...f.meta.floor, [tab]: e.target.value } } })} />
            </label>
            <label className="block text-sm font-medium">{t.fWalk}
              <input className={`${inputCls} mt-1`} value={f.meta.walk} onChange={(e) => setF({ ...f, meta: { ...f.meta, walk: e.target.value } })} />
            </label>
          </div>
        )}
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

/* ============================ 巴士實時到站（九巴／城巴開放數據） ============================ */
const KAT_POS = { lat: 22.3305, lng: 114.1993 }; // 啟德站大約位置
const BUS_RADIUS_M = 650; // 搜尋車站範圍（米）
const KEY_ROUTES = ['20', '20A', '22', '22D', '22M', '22R', '22S', '22X', '5R'];
const KMB_BASES = ['/api/kmb', 'https://data.etabus.gov.hk/v1/transport/kmb'];
const CTB_BASES = ['/api/ctb', 'https://rt.data.gov.hk/v2/transport/citybus'];
// 城巴沒有「按車站查詢所有路線」的接口，所以要列出途經啟德站一帶的城巴路線
// 啟德的 20／22 系列均為城巴路線；日後有新城巴路線開辦，在此加入路線號碼即可
const CTB_ROUTES = ['20', '20A', '20X', '22', '22D', '22M', '22R', '22S', '22X'];

const apiGet = (bases, path, timeout = 8000) => fetchFirst(bases.map((b) => b + path), (r) => r.json(), timeout);
function distM(a, b) {
  const R = 6371000, toR = Math.PI / 180;
  const dLat = (b.lat - a.lat) * toR, dLng = (b.lng - a.lng) * toR;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * toR) * Math.cos(b.lat * toR) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}
const lsGet = (k) => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

// 找出啟德站附近的九巴車站（每 24 小時重新下載一次，新增的巴士站會自動納入）
async function nearbyKmbStops() {
  const cache = lsGet('kat-kmb-stops-v1');
  if (cache && Date.now() - cache.t < 864e5) return cache.stops;
  const j = await apiGet(KMB_BASES, '/stop', 20000);
  if (!j || !Array.isArray(j.data)) return cache ? cache.stops : null;
  const stops = j.data
    .map((s) => ({ id: s.stop, zh: s.name_tc, en: s.name_en, lat: +s.lat, lng: +s.long }))
    .map((s) => ({ ...s, d: distM(KAT_POS, s) }))
    .filter((s) => s.d <= BUS_RADIUS_M)
    .sort((a, b) => a.d - b.d)
    .slice(0, 30);
  lsSet('kat-kmb-stops-v1', { t: Date.now(), stops });
  return stops;
}

// 城巴：按 CTB_ROUTES 找出每條路線、每個方向最接近啟德站的車站（結果快取 24 小時）
async function inBatches(list, size, fn) {
  const out = [];
  for (let k = 0; k < list.length; k += size) out.push(...(await Promise.all(list.slice(k, k + size).map(fn))));
  return out;
}
async function nearbyCtbStops() {
  if (!CTB_ROUTES.length) return [];
  const cacheKey = CTB_ROUTES.join(',');
  const cache = lsGet('kat-ctb-stops-v2');
  if (cache && Date.now() - cache.t < 864e5 && cache.key === cacheKey) return cache.list;
  // 1. 取得每條路線兩個方向的車站序列（循環線只有 outbound）
  const combos = CTB_ROUTES.flatMap((route) => ['inbound', 'outbound'].map((dir) => ({ route, dir })));
  const seqs = await inBatches(combos, 8, async (c) => {
    const j = await apiGet(CTB_BASES, `/route-stop/CTB/${c.route}/${c.dir}`);
    return { ...c, stops: ((j && j.data) || []).map((r) => r.stop) };
  });
  if (seqs.every((s) => s.stops.length === 0)) return cache ? cache.list : null;
  // 2. 取得車站座標（永久快取，只下載未見過的車站）
  const info = lsGet('kat-ctb-stopinfo-v1') || {};
  const missing = [...new Set(seqs.flatMap((s) => s.stops))].filter((id) => !info[id]);
  await inBatches(missing, 10, async (id) => {
    const j = await apiGet(CTB_BASES, `/stop/${id}`);
    const s = j && j.data;
    if (s && s.lat) info[id] = { zh: s.name_tc, en: s.name_en, lat: +s.lat, lng: +s.long };
  });
  lsSet('kat-ctb-stopinfo-v1', info);
  // 3. 每條路線每個方向，揀最接近啟德站而又在範圍內的車站
  const list = [];
  for (const s of seqs) {
    let best = null;
    for (const id of s.stops) {
      const p = info[id];
      if (!p) continue;
      const d = distM(KAT_POS, p);
      if (d <= BUS_RADIUS_M && (!best || d < best.d)) best = { id, zh: p.zh, en: p.en, d };
    }
    if (best) list.push({ route: s.route, dir: s.dir, stop: best });
  }
  lsSet('kat-ctb-stops-v2', { t: Date.now(), key: cacheKey, list });
  return list;
}

// 取得所有途經附近車站的路線及到站時間（新開辦路線會自動出現，取消的路線會自動消失）
async function loadBusEtas() {
  const stops = (await nearbyKmbStops()) || [];
  const results = await inBatches(stops, 10, (s) => apiGet(KMB_BASES, `/stop-eta/${s.id}`).then((j) => ({ s, data: (j && j.data) || null })));
  const kmbOk = results.some((r) => r.data !== null);
  const map = {};
  for (const { s, data } of results) {
    for (const e of data || []) {
      const key = `KMB|${e.route}|${e.dir}|${e.service_type}`;
      if (!map[key]) map[key] = { key, co: 'KMB', route: e.route, destZh: e.dest_tc, destEn: e.dest_en, stop: s, etas: [] };
      if (map[key].stop.id === s.id && e.eta) map[key].etas.push({ at: Date.parse(e.eta), rmkZh: e.rmk_tc, rmkEn: e.rmk_en });
    }
  }
  const ctb = (await nearbyCtbStops()) || [];
  const ctbEtas = await inBatches(ctb, 8, async (c) => {
    const j = await apiGet(CTB_BASES, `/eta/CTB/${c.stop.id}/${c.route}`);
    return { c, rows: ((j && j.data) || []).filter((e) => (c.dir === 'inbound' ? e.dir === 'I' : e.dir === 'O')) };
  });
  for (const { c, rows } of ctbEtas) {
    const key = `CTB|${c.route}|${c.dir}`;
    map[key] = {
      key, co: 'CTB', route: c.route, stop: c.stop,
      destZh: rows[0] ? rows[0].dest_tc : '', destEn: rows[0] ? rows[0].dest_en : '',
      etas: rows.filter((e) => e.eta).map((e) => ({ at: Date.parse(e.eta), rmkZh: e.rmk_tc, rmkEn: e.rmk_en })),
    };
  }
  if (!kmbOk && Object.keys(map).length === 0) return null;
  // 路線改動監察：記錄首次出現時間，用來標示「新路線」
  const seen = lsGet('kat-bus-seen-v1') || { __init: Date.now() };
  const now = Date.now();
  const routes = Object.values(map).map((r) => {
    if (!seen[r.key]) seen[r.key] = now;
    const isNew = seen[r.key] > seen.__init + 36e5 && now - seen[r.key] < 7 * 864e5;
    const etas = r.etas.filter((x) => !Number.isNaN(x.at)).sort((a, b) => a.at - b.at).slice(0, 3);
    return { ...r, etas, isNew };
  });
  lsSet('kat-bus-seen-v1', seen);
  routes.sort((a, b) => a.route.localeCompare(b.route, 'en', { numeric: true }) || a.stop.d - b.stop.d);
  return { routes, updated: now };
}

function BusPanel({ t, lang, items }) {
  const [data, setData] = useState(null);
  const [status, setStatus] = useState('loading');
  const [filter, setFilter] = useState('key');
  const [now, setNow] = useState(Date.now());

  const load = useCallback(async () => {
    const d = await loadBusEtas();
    if (d) { setData(d); setStatus('live'); } else setStatus((s) => (s === 'live' ? 'live' : 'offline'));
  }, []);
  useEffect(() => { load(); const i = setInterval(load, 30000); return () => clearInterval(i); }, [load]);
  useEffect(() => { const i = setInterval(() => setNow(Date.now()), 15000); return () => clearInterval(i); }, []);

  const routes = data ? data.routes.filter((r) => filter === 'all' || KEY_ROUTES.includes(r.route)) : [];
  const staticRoutes = items.filter((x) => x.category === 'transport');
  const zhLike = lang === 'zh' || lang === 'ja';
  const etaLabel = (at) => {
    const m = Math.round((at - now) / 60000);
    return m <= 0 ? t.busArriving : fmt(t.busMin, { n: m });
  };

  return (
    <section className="space-y-4">
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-lg font-bold"><Bus size={19} />{t.busTitle}</h2>
          <div className="flex items-center gap-2 text-xs">
            <span className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 font-medium ${status === 'live' ? 'bg-emerald-100 text-emerald-800' : 'bg-[var(--warn-bg)] text-[var(--warn-ink)]'}`}>
              <span className={`h-2 w-2 rounded-full ${status === 'live' ? 'bg-emerald-500' : 'bg-amber-500'}`} />
              {status === 'loading' ? t.busLoading : status === 'live' ? t.busLive : t.busOfflineShort}
            </span>
            <button onClick={load} aria-label="Refresh" className="rounded-md p-1.5 text-[var(--muted)] hover:bg-[var(--surface-2)] hover:text-[var(--ink)]"><RefreshCw size={14} /></button>
          </div>
        </div>

        <div className="mt-3 flex gap-2">
          {[{ id: 'key', label: t.busKey }, { id: 'all', label: t.busAll }].map((f) => (
            <button key={f.id} onClick={() => setFilter(f.id)}
              className={`rounded-full border px-3.5 py-1.5 text-sm font-medium ${filter === f.id ? 'border-transparent bg-[var(--ink)] text-[var(--surface)]' : 'border-[var(--border)] hover:border-[var(--ink)]'}`}>
              {f.label}
            </button>
          ))}
        </div>

        {status === 'loading' && <p className="mt-4 text-sm text-[var(--muted)]">{t.busLoading}</p>}
        {status === 'offline' && <p className="mt-4 rounded-lg p-3 text-sm" style={{ background: 'var(--warn-bg)', color: 'var(--warn-ink)' }}>{t.busOffline}</p>}

        {status === 'live' && (
          routes.length === 0 ? (
            <p className="mt-4 text-sm text-[var(--muted)]">{t.busNone}</p>
          ) : (
            <motion.div layout className="mt-4 grid gap-2 sm:grid-cols-2">
              <AnimatePresence mode="popLayout">
                {routes.map((r) => (
                  <motion.article key={r.key} layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                    className="flex items-center gap-3 rounded-xl border border-[var(--border)] p-3">
                    <div className="flex w-16 shrink-0 flex-col items-center">
                      <span className="num rounded-md px-2 py-1 text-xl font-bold leading-none text-white" style={{ background: r.co === 'KMB' ? '#C8102E' : '#F2B705', color: r.co === 'KMB' ? '#fff' : '#111' }}>{r.route}</span>
                      <span className="mt-1 text-[10px] text-[var(--muted)]">{r.co === 'KMB' ? t.busKmb : t.busCtb}</span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-bold">
                        {(zhLike ? r.destZh : r.destEn) ? fmt(t.busTo, { dest: zhLike ? r.destZh : r.destEn }) : `${r.co === 'KMB' ? t.busKmb : t.busCtb} ${r.route}`}
                        {r.isNew && <span className="ml-1.5 rounded bg-[var(--sign)] px-1.5 py-0.5 text-[10px] font-bold text-[#111418]">{t.busNew}</span>}
                      </p>
                      <p className="truncate text-xs text-[var(--muted)]">{zhLike ? r.stop.zh : r.stop.en} · {fmt(t.busDist, { m: r.stop.d })}</p>
                      {r.etas[0] && (zhLike ? r.etas[0].rmkZh : r.etas[0].rmkEn) && <p className="truncate text-[11px] text-[var(--muted)]">{zhLike ? r.etas[0].rmkZh : r.etas[0].rmkEn}</p>}
                    </div>
                    <div className="shrink-0 text-right">
                      {r.etas.length === 0 ? (
                        <span className="text-xs text-[var(--muted)]">{t.busNoEta}</span>
                      ) : (
                        <>
                          <span className="num block text-lg font-bold" style={{ color: 'var(--tml)' }}>{etaLabel(r.etas[0].at)}</span>
                          <span className="num block text-[11px] text-[var(--muted)]">{r.etas.slice(1).map((e) => etaLabel(e.at)).join(' · ')}</span>
                        </>
                      )}
                    </div>
                  </motion.article>
                ))}
              </AnimatePresence>
            </motion.div>
          )
        )}
        <p className="mt-4 text-xs leading-relaxed text-[var(--muted)]">{t.busSource}</p>
      </div>

      <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-5">
        <h3 className="flex items-center gap-2 text-base font-bold"><MapPin size={17} />{t.busLeaflet}</h3>
        <ul className="mt-3 space-y-2">
          {staticRoutes.map((x) => (
            <li key={x.id} className="flex items-center gap-3 rounded-lg bg-[var(--surface-2)] px-3 py-2">
              <ExitPlate exit={x.exit} />
              <span className="text-sm">{tx(x.name, lang)}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function SyncModal({ open, diff, onClose, onApply, t, lang, busy }) {
  const groups = diff ? [
    { k: 'added', label: t.syncAdded, list: diff.added, color: 'text-emerald-700' },
    { k: 'changed', label: t.syncChanged, list: diff.changed, color: 'text-[var(--warn-ink)]' },
    { k: 'removed', label: t.syncRemoved, list: diff.removed, color: 'text-red-600' },
  ] : [];
  return (
    <Modal open={open} onClose={onClose} wide>
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-lg font-bold"><RefreshCw size={18} />{t.syncReview}</h2>
        <button onClick={onClose} aria-label="Close" className="rounded p-1 text-[var(--muted)] hover:text-[var(--ink)]"><X size={18} /></button>
      </div>
      <p className="mt-1 text-xs text-[var(--muted)]">{fmt(t.dataVersion, { v: DATA_VERSION })}</p>
      {diff && diff.total === 0 ? (
        <p className="mt-4 text-sm">{t.syncNothing}</p>
      ) : (
        <div className="mt-4 space-y-3">
          {groups.filter((g) => g.list.length).map((g) => (
            <div key={g.k}>
              <h3 className={`text-sm font-bold ${g.color}`}>{g.label}（{g.list.length}）</h3>
              <ul className="mt-1 max-h-40 space-y-1 overflow-y-auto rounded-lg bg-[var(--surface-2)] p-2 text-sm">
                {g.list.map((x) => <li key={x.id} className="flex items-center gap-2"><ExitPlate exit={x.exit} /><span className="truncate">{tx(x.name, lang)}</span></li>)}
              </ul>
            </div>
          ))}
          <p className="text-xs text-[var(--muted)]">{t.syncNote}</p>
        </div>
      )}
      <div className="mt-5 flex justify-end gap-2">
        <button onClick={onClose} className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm font-medium">{t.cancel}</button>
        {diff && diff.total > 0 && (
          <button onClick={onApply} disabled={busy} className="rounded-lg px-4 py-2 text-sm font-bold text-white disabled:opacity-60" style={{ background: LINES.TML.color }}>{t.syncApply}</button>
        )}
      </div>
    </Modal>
  );
}

/* ============================ 醫院交通指引 ============================ */
const HOSPITAL_IDS = new Set(['p23-hkch', 'p30-kt-hosp']);
const OP_STYLE = { CTB: { bg: '#F2B705', fg: '#111' }, KMB: { bg: '#C8102E', fg: '#fff' }, GMB: { bg: '#0F7B4F', fg: '#fff' }, REHAB: { bg: '#5A6573', fg: '#fff' } };
// 由啟德站往返香港兒童醫院／啟德醫院（資料：醫管局、運輸署及 2026 年 10 月報道，出發前請以營辦商公布為準）
const HOSP_FROM_KAT = [
  { op: 'CTB', route: '22S', exit: 'C', zh: '啟德站 ↔ 啟德郵輪碼頭（循環線）；星期一至五 10:30–19:30 設短途班次，由啟德站直達啟德醫院及香港兒童醫院。', en: 'Kai Tak Station ↔ Kai Tak Cruise Terminal (circular). Mon–Fri 10:30–19:30 short trips run from Kai Tak Station to both hospitals.' },
  { op: 'CTB', route: '22M', exit: 'A', zh: '啟德郵輪碼頭 ↔ 土瓜灣（循環線），途經啟德站及兩間醫院。', en: 'Kai Tak Cruise Terminal ↔ To Kwa Wan (circular), via Kai Tak Station and both hospitals.' },
  { op: 'GMB', route: '88A', exit: null, zh: '黃大仙站 ↔ 啟德醫院（循環線），途經啟德站一帶。', en: 'Wong Tai Sin Station ↔ Kai Tak Hospital (circular), via the Kai Tak Station area.' },
  { op: 'REHAB', route: '♿', exit: 'A', zh: '復康穿梭巴士站，供有需要人士往返兩間醫院。', en: 'Rehabus feeder stop to both hospitals for passengers who need it.' },
];
const HOSP_OTHER = {
  zh: '城巴 20A、20X、22；九巴 5R、X6C、15A，以及九巴 11A、17A 往啟德醫院特別班次；專線小巴 86（九龍灣站 A 出口，約 10 分鐘）、22A、68、90A、90B。',
  en: 'Citybus 20A, 20X, 22; KMB 5R, X6C, 15A, plus KMB 11A and 17A special trips to Kai Tak Hospital; green minibus 86 (Kowloon Bay Station Exit A, about 10 min), 22A, 68, 90A, 90B.',
};

/* ============================ 實時到站（城巴／專線小巴開放數據）：通用引擎 ============================ */
// 每個「目的地」定義：位置座標 + 要顯示的接駁路線
// 系統會自動找出「啟德站附近、之後最少站數就到目的地」的上車站及方向，毋須人手輸入站牌 ID；
// 路線改道或新增車站時，下次重新計算（每 24 小時）便會自動更新。
const TRANSIT_TARGETS = {
  hosp: {
    pos: { lat: 22.3163, lng: 114.2088 }, // 香港兒童醫院／啟德醫院（承昌道1號）一帶
    routes: [{ op: 'CTB', route: '22S' }, { op: 'CTB', route: '22M' }, { op: 'GMB', route: '88A' }],
  },
  cruise: {
    pos: { lat: 22.3068, lng: 114.2135 }, // 啟德郵輪碼頭（承豐道33號）
    routes: [{ op: 'CTB', route: '22M' }, { op: 'CTB', route: '22' }, { op: 'GMB', route: '86' }],
  },
  runway: {
    pos: { lat: 22.3135, lng: 114.2125 }, // 跑道區屋苑（維港1號／天瀧一帶，承豐道21–22號）
    routes: [{ op: 'CTB', route: '22X' }, { op: 'CTB', route: '22D' }, { op: 'CTB', route: '22M' }, { op: 'CTB', route: '22' }, { op: 'GMB', route: '86' }],
  },
};
const GMB_BASES = ['/api/gmb', 'https://data.etagmb.gov.hk'];
const BOARD_RADIUS_M = 450; // 啟德站上車站範圍
const DEST_RADIUS_M = 450;  // 目的地下車站範圍

// 由車站序列中，揀出「啟德站附近、之後最少站數即到目的地」的上車站
function pickBoardingStop(stops, posOf, destPos) {
  let best = null;
  stops.forEach((s, idx) => {
    const p = posOf(s);
    if (!p) return;
    const d = distM(KAT_POS, p);
    if (d > BOARD_RADIUS_M) return;
    for (let k = idx + 1; k < stops.length; k++) {
      const q = posOf(stops[k]);
      if (q && distM(destPos, q) <= DEST_RADIUS_M) {
        const hops = k - idx;
        if (!best || hops < best.hops || (hops === best.hops && d < best.d)) best = { s, d, hops };
        break;
      }
    }
  });
  return best;
}

async function findCtbStop(route, destPos) {
  let best = null;
  const info = lsGet('kat-ctb-stopinfo-v1') || {};
  for (const dir of ['outbound', 'inbound']) {
    const rs = await apiGet(CTB_BASES, `/route-stop/CTB/${route}/${dir}`);
    const seq = ((rs && rs.data) || []).map((r) => ({ id: r.stop, seq: +r.seq }));
    if (!seq.length) continue;
    const missing = seq.map((s) => s.id).filter((id) => !info[id]);
    await inBatches(missing, 10, async (id) => {
      const j = await apiGet(CTB_BASES, `/stop/${id}`);
      const s = j && j.data;
      if (s && s.lat) info[id] = { zh: s.name_tc, en: s.name_en, lat: +s.lat, lng: +s.long };
    });
    const pick = pickBoardingStop(seq, (s) => info[s.id], destPos);
    if (pick && (!best || pick.hops < best.hops)) {
      const p = info[pick.s.id];
      best = { co: 'CTB', route, dir, seq: pick.s.seq, id: pick.s.id, zh: p.zh, en: p.en, d: pick.d, hops: pick.hops };
    }
  }
  lsSet('kat-ctb-stopinfo-v1', info);
  return best;
}

async function findGmbStop(code, destPos) {
  const j = await apiGet(GMB_BASES, `/route/KLN/${code}`);
  const routes = (j && j.data) || [];
  const info = lsGet('kat-gmb-stopinfo-v1') || {};
  let best = null;
  for (const r of routes) {
    for (const dirn of r.directions || []) {
      const rs = await apiGet(GMB_BASES, `/route-stop/${r.route_id}/${dirn.route_seq}`);
      const stops = (rs && rs.data && rs.data.route_stops) || [];
      await inBatches(stops.filter((s) => !info[s.stop_id]), 10, async (s) => {
        const st = await apiGet(GMB_BASES, `/stop/${s.stop_id}`);
        const c = st && st.data && st.data.coordinates && st.data.coordinates.wgs84;
        if (c) info[s.stop_id] = { lat: +c.latitude, lng: +c.longitude };
      });
      const pick = pickBoardingStop(stops, (s) => info[s.stop_id], destPos);
      if (pick && (!best || pick.hops < best.hops)) {
        best = { co: 'GMB', route: code, routeId: r.route_id, routeSeq: dirn.route_seq, stopSeq: pick.s.stop_seq, zh: pick.s.name_tc, en: pick.s.name_en, d: pick.d, hops: pick.hops };
      }
    }
  }
  lsSet('kat-gmb-stopinfo-v1', info);
  return best;
}

// 每個目的地的上車站配置，每 24 小時重新計算一次
async function getTransitPlan(key) {
  const target = TRANSIT_TARGETS[key];
  const cacheKey = `kat-transit-plan-v1-${key}`;
  const cache = lsGet(cacheKey);
  if (cache && Date.now() - cache.t < 864e5) return cache.plan;
  const found = await Promise.all(target.routes.map((r) => (r.op === 'CTB' ? findCtbStop(r.route, target.pos) : findGmbStop(r.route, target.pos))));
  const plan = {};
  target.routes.forEach((r, i) => { plan[`${r.op}|${r.route}`] = found[i]; });
  if (found.every((x) => !x)) return cache ? cache.plan : null;
  lsSet(cacheKey, { t: Date.now(), plan });
  return plan;
}

// 取得某目的地所有路線的到站時間：{ 'CTB|22M': { stop, etas: [...] | null } | null }
async function loadTransitEtas(key) {
  const plan = await getTransitPlan(key);
  if (!plan) return null;
  const out = {};
  await Promise.all(Object.entries(plan).map(async ([k, s]) => {
    if (!s) { out[k] = null; return; }
    let etas = null;
    if (s.co === 'CTB') {
      const j = await apiGet(CTB_BASES, `/eta/CTB/${s.id}/${s.route}`);
      if (j) etas = (j.data || [])
        .filter((e) => (s.dir === 'inbound' ? e.dir === 'I' : e.dir === 'O') && (e.seq == null || +e.seq === s.seq) && e.eta)
        .map((e) => ({ at: Date.parse(e.eta), rmkZh: e.rmk_tc, rmkEn: e.rmk_en }));
    } else {
      const j = await apiGet(GMB_BASES, `/eta/route-stop/${s.routeId}/${s.routeSeq}/${s.stopSeq}`);
      if (j) etas = ((j.data && j.data.eta) || []).map((e) => ({ at: e.timestamp ? Date.parse(e.timestamp) : Date.now() + (e.diff || 0) * 60000, rmkZh: e.remarks_tc, rmkEn: e.remarks_en }));
    }
    if (etas) etas = etas.filter((e) => !Number.isNaN(e.at)).sort((a, b) => a.at - b.at).slice(0, 3);
    out[k] = { stop: s, etas };
  }));
  return out;
}

// 同一目的地的多張卡片共用同一份數據，25 秒內不重複下載
const TRANSIT_CACHE = {};
function getTransitEtas(key, force) {
  const c = TRANSIT_CACHE[key];
  if (!force && c && Date.now() - c.t < 25000) return c.p;
  const p = loadTransitEtas(key).catch(() => null);
  TRANSIT_CACHE[key] = { t: Date.now(), p };
  return p;
}

// React Hook：每 30 秒自動更新到站時間，每 15 秒更新倒數
function useTransitEta(key) {
  const [data, setData] = useState(null);
  const [status, setStatus] = useState(key ? 'loading' : 'idle');
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!key) return undefined;
    let alive = true;
    const load = (force) => getTransitEtas(key, force).then((d) => {
      if (!alive) return;
      if (d) { setData(d); setStatus('live'); } else setStatus((s) => (s === 'live' ? 'live' : 'offline'));
    });
    load(false);
    const i = setInterval(() => { if (!document.hidden) load(true); }, 30000);
    const k = setInterval(() => setNow(Date.now()), 15000);
    return () => { alive = false; clearInterval(i); clearInterval(k); };
  }, [key]);
  return { data, status, now };
}

const etaMinLabel = (at, now, t) => {
  const m = Math.round((at - now) / 60000);
  return m <= 0 ? t.busArriving : fmt(t.busMin, { n: m });
};

// 卡片上的「實時到站班次倒數 Badge」
function TransitEtaBadges({ targetKey, t, lang }) {
  const { data, status, now } = useTransitEta(targetKey);
  const target = TRANSIT_TARGETS[targetKey];
  if (!target) return null;
  const zh = lang === 'zh' || lang === 'ja';
  const rows = target.routes.map((r) => ({ ...r, key: `${r.op}|${r.route}`, live: data && data[`${r.op}|${r.route}`] }));
  // 已確認不經啟德站附近的路線，不在卡片顯示
  const shown = status === 'live' ? rows.filter((r) => r.live) : rows;
  return (
    <div className="mt-3 space-y-1.5 rounded-lg border border-[var(--border)] p-2.5">
      <p className="flex items-center justify-between text-[11px] font-semibold text-[var(--muted)]">
        <span>{t.etaTitle}</span>
        {status === 'live' && <span className="flex items-center gap-1 text-emerald-700"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />{t.hospLive}</span>}
      </p>
      {status === 'loading' && (
        <div className="space-y-1.5" aria-label={t.hospLoading}>
          {[0, 1].map((i) => <div key={i} className="h-6 animate-pulse rounded-md bg-[var(--surface-2)]" />)}
        </div>
      )}
      {status !== 'loading' && shown.length === 0 && <p className="text-xs text-[var(--muted)]">{t.etaNone}</p>}
      {status !== 'loading' && shown.map((r) => {
        const icon = r.op === 'GMB' ? '🚐' : '🚌';
        const name = r.op === 'GMB' ? fmt(t.etaGmb, { r: r.route }) : fmt(t.etaCtb, { r: r.route });
        let body;
        if (status === 'offline' || !r.live || r.live.etas === null) body = <span className="text-[var(--muted)]">{t.etaFallback}</span>;
        else if (!r.live.etas.length) body = <span className="text-[var(--muted)]">{t.busNoEta}</span>;
        else body = <b className="num" style={{ color: 'var(--tml)' }}>{r.live.etas.map((e) => etaMinLabel(e.at, now, t)).join(' | ')}</b>;
        return (
          <div key={r.key} className="rounded-md bg-[var(--surface-2)] px-2 py-1.5 text-xs">
            <p className="flex flex-wrap items-baseline gap-x-1.5"><span>{icon} {name}:</span>{body}</p>
            {r.live && r.live.stop && <p className="mt-0.5 text-[10px] text-[var(--muted)]">{fmt(t.hospAtStop, { stop: zh ? r.live.stop.zh : r.live.stop.en })}</p>}
          </div>
        );
      })}
    </div>
  );
}

// 判斷卡片應顯示哪個目的地的實時班次
const ETA_TARGET_BY_ID = {
  'p23-hkch': 'hosp', 'p30-kt-hosp': 'hosp', 't-22s-hosp': 'hosp',
  't-22m-cruise': 'cruise', 'bk-ice-cruise': 'cruise',
  't-22d-runway': 'runway', 't-22x-one-victoria': 'runway',
};
function etaTargetOf(item) {
  if (!item) return null;
  if (ETA_TARGET_BY_ID[item.id]) return ETA_TARGET_BY_ID[item.id];
  if (String(item.id).startsWith('rw-')) return 'runway';
  const m = item.meta || {};
  if (m.mall === 'runway') return m.transfer && String(m.transfer.zh || '').includes('22M') ? 'cruise' : 'runway';
  return null;
}

function HospitalGuide({ t, lang }) {
  const zh = lang === 'zh' || lang === 'ja';
  const { data: live, status, now } = useTransitEta('hosp');
  const liveLine = (route) => {
    if (status === 'loading') return <span className="inline-block h-4 w-24 animate-pulse rounded bg-[var(--border)]" aria-label={t.hospLoading} />;
    const op = route === '88A' ? 'GMB' : 'CTB';
    const r = live && live[`${op}|${route}`];
    if (status === 'offline' || !r || r.etas === null) return <span className="text-[var(--muted)]">{t.etaFallback}</span>;
    if (!r.etas.length) return <span className="text-[var(--muted)]">{t.busNoEta}</span>;
    return <b className="num" style={{ color: 'var(--tml)' }}>{r.etas.map((e) => etaMinLabel(e.at, now, t)).join(' | ')}</b>;
  };

  return (
    <div className="mt-3 space-y-2">
      <div className="flex gap-2 rounded-lg border-2 border-red-500 bg-red-50 px-3 py-2 text-[13px] font-bold leading-relaxed text-red-700">
        <AlertTriangle size={16} className="mt-0.5 shrink-0" />{t.hospWarn}
      </div>
      <p className="flex items-center justify-between text-xs font-semibold text-[var(--muted)]">
        <span>{t.hospFromKat}</span>
        {status === 'live' && <span className="flex items-center gap-1 text-emerald-700"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />{t.hospLive}</span>}
      </p>
      <ul className="space-y-1.5">
        {HOSP_FROM_KAT.map((r) => {
          const op = r.route === '88A' ? 'GMB' : 'CTB';
          const stop = live && live[`${op}|${r.route}`] && live[`${op}|${r.route}`].stop;
          return (
            <li key={r.op + r.route} className="flex items-start gap-2 rounded-lg bg-[var(--surface-2)] p-2">
              <span className="num shrink-0 rounded px-1.5 py-0.5 text-sm font-bold" style={{ background: OP_STYLE[r.op].bg, color: OP_STYLE[r.op].fg }}>{r.route}</span>
              <span className="min-w-0 flex-1 text-xs leading-relaxed">
                <b>{t['op' + r.op]}</b>　{zh ? r.zh : r.en}
                <span className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-[var(--muted)]">
                  {r.exit ? <><ExitPlate exit={r.exit} />{fmt(t.hospBoard, { exit: r.exit })}</> : (stop ? fmt(t.hospAtStop, { stop: zh ? stop.zh : stop.en }) : t.hospSign)}
                </span>
                {r.op !== 'REHAB' && <span className="mt-1 block">{r.op === 'GMB' ? '🚐' : '🚌'} {liveLine(r.route)}</span>}
              </span>
            </li>
          );
        })}
      </ul>
      <p className="text-xs leading-relaxed text-[var(--muted)]"><b>{t.hospOther}：</b>{zh ? HOSP_OTHER.zh : HOSP_OTHER.en}</p>
    </div>
  );
}

/* ============================ 外幣找換指南 ============================ */
const FX_LOCAL_IDS = ['bk-hsbc-kt', 'bk-boc-kt'];
const FX_HOT = [
  { code: 'TST', zh: '重慶大廈地下一帶找換店集中，可由尖東站經行人隧道前往。', en: 'Money changers cluster on the ground floor of Chungking Mansions, reached from East Tsim Sha Tsui via the subway.', q: 'money exchange Chungking Mansions Tsim Sha Tsui' },
  { code: 'MOK', zh: '彌敦道一帶有不少找換店。', en: 'Plenty of money changers along Nathan Road.', q: 'money exchange near Mong Kok MTR station' },
  { code: 'DIH', zh: '屯馬綫一站即達，可在地圖查看車站附近的找換店。', en: 'One stop away on the Tuen Ma Line. Check the map for changers near the station.', q: 'money exchange near Diamond Hill MTR station' },
];
const MSO_REGISTER_URL = 'https://eservices.customs.gov.hk/MSOS/wsrh/001s1?request_locale=en';

function MoneyExchangeFinder({ t, lang, items, onRoute }) {
  const zh = lang === 'zh' || lang === 'ja';
  const local = FX_LOCAL_IDS.map((id) => items.find((x) => x.id === id)).filter(Boolean);
  return (
    <motion.section initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mb-4 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-5">
      <h2 className="flex items-center gap-2 text-lg font-bold"><Banknote size={19} />💱 {t.fxTitle}</h2>
      <h3 className="mt-3 text-sm font-bold">{t.fxLocal}</h3>
      <p className="mt-1 text-xs text-[var(--muted)]">{t.fxLocalNote}</p>
      <ul className="mt-2 space-y-1.5">
        {local.map((x) => (
          <li key={x.id} className="flex items-center gap-2 rounded-lg bg-[var(--surface-2)] p-2">
            <ExitPlate exit={x.exit} />
            <span className="min-w-0 flex-1 truncate text-sm">{tx(x.name, lang)}</span>
            <a href={mapsUrl(x.mapQuery || x.name.zh)} target="_blank" rel="noopener noreferrer" aria-label={t.navigate} className="rounded-md p-1.5 hover:bg-[var(--surface)]"><Navigation size={15} /></a>
          </li>
        ))}
      </ul>

      <h3 className="mt-4 text-sm font-bold">{t.fxHot}</h3>
      <div className="mt-2 grid gap-2 md:grid-cols-3">
        {FX_HOT.map((h) => {
          const plan = planTrip(h.code, FARE_CACHE);
          const xfer = plan && plan.transfers.length ? fmt(t.fxTransfers, { n: plan.transfers.length }) : t.fxDirect;
          return (
            <div key={h.code} className="flex flex-col rounded-xl border border-[var(--border)] p-3">
              <p className="flex items-center gap-2 font-bold"><StationDots code={h.code} />{stName(h.code, lang)}</p>
              {plan && <p className="num mt-1 text-xs text-[var(--muted)]">{fmt(t.fxSummary, { m: plan.mins, f: money(plan.fare && plan.fare.oct), x: xfer })}</p>}
              <p className="mt-1.5 flex-1 text-xs leading-relaxed">{zh ? h.zh : h.en}</p>
              <div className="mt-2 flex gap-1.5">
                <button onClick={() => onRoute(h.code)} className="flex-1 rounded-lg px-2 py-1.5 text-xs font-bold text-white" style={{ background: LINES.TML.color }}>{t.fxRoute}</button>
                <a href={mapsUrl(h.q)} target="_blank" rel="noopener noreferrer" className="flex flex-1 items-center justify-center gap-1 rounded-lg border border-[var(--border)] px-2 py-1.5 text-xs font-bold hover:border-[var(--ink)]"><Navigation size={12} />{t.fxMap}</a>
              </div>
            </div>
          );
        })}
      </div>
      <p className="mt-3 text-xs leading-relaxed text-[var(--muted)]">
        {t.fxTips}{' '}
        <a href={MSO_REGISTER_URL} target="_blank" rel="noopener noreferrer" className="font-semibold underline">{t.fxLicence}</a>
      </p>
    </motion.section>
  );
}

/* ============================ App ============================ */
function App() {
  const [lang, setLang] = useState('zh');
  const [tab, setTab] = useState('land');
  const [routeDest, setRouteDest] = useState(null);
  const [octBanner, setOctBanner] = useState(true);
  const goRoute = (code) => { setRouteDest(code); setTab('mtr'); try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch {} };
  const [items, setItems] = useState(SEED);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [confirmReq, setConfirmReq] = useState(null);
  const [toast, setToast] = useState('');
  const [syncOpen, setSyncOpen] = useState(false);
  const [syncBusy, setSyncBusy] = useState(false);
  const t = UI[lang];
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const tRef = useRef(t);
  tRef.current = t;
  const diff = useMemo(() => diffWithSeed(items), [items]);

  useEffect(() => { db.list().then((d) => { if (d && d.length) setItems(d); }).catch(() => {}); }, []);

  // 背景輪詢：每 60 秒（及切換回此分頁時）檢查雲端資料，有更新即自動套用，毋須重新整理
  useEffect(() => {
    if (!supabase) return undefined;
    const poll = async () => {
      if (document.hidden) return;
      try {
        const d = await db.list();
        if (d && d.length && hashItems(d) !== hashItems(itemsRef.current)) { setItems(d); setToast(tRef.current.liveUpdated); }
      } catch {}
    };
    const i = setInterval(poll, 60000);
    const onVis = () => { if (!document.hidden) poll(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { clearInterval(i); document.removeEventListener('visibilitychange', onVis); };
  }, []);
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
    setSyncBusy(true);
    try { const next = await applySeedSync(items); setItems(next); setSyncOpen(false); setToast(t.synced); } catch (e) { setToast(String(e.message || e)); }
    setSyncBusy(false);
  };
  const askDelete = (item) => setConfirmReq({ message: fmt(t.confirmDel, { name: tx(item.name, lang) }), label: t.del, action: () => handleDelete(item) });
  const handleLoginSuccess = async () => {
    setIsAdmin(true);
    try { if (await db.seedIfEmpty(SEED)) { setItems(SEED); setToast(t.seeded); } } catch (e) { setToast(String(e.message || e)); }
  };
  const handleLogout = () => { if (supabase) supabase.auth.signOut(); setIsAdmin(false); };

  const TABS = [
    { id: 'land', label: t.tabLand, Icon: MapPin },
    { id: 'mtr', label: t.tabMtr, Icon: Train },
    { id: 'bus', label: t.tabBus, Icon: Bus },
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
                <button onClick={() => setSyncOpen(true)} className="relative flex items-center gap-1.5 rounded-md bg-[#111418] px-2.5 py-1 text-xs font-bold text-[var(--sign)]">
                  <RefreshCw size={13} />{diff.total > 0 ? fmt(t.syncBanner, { n: diff.total }) : t.syncReview}
                  {diff.total > 0 && <span className="absolute -right-1 -top-1 h-2.5 w-2.5 animate-pulse rounded-full bg-red-500" />}
                </button>
              </span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {octBanner && (
          <motion.div initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }} className="overflow-hidden bg-[var(--sign)] text-[#111418]">
            <div className="mx-auto flex max-w-6xl items-start gap-2 px-4 py-2.5 text-sm font-semibold">
              <AlertTriangle size={17} className="mt-0.5 shrink-0" />
              <span className="flex-1">{t.octBanner}</span>
              <button onClick={() => setOctBanner(false)} aria-label="Close" className="rounded p-0.5 hover:bg-black/10"><X size={16} /></button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <StationBoard t={t} lang={lang} />

      <main className="mx-auto max-w-6xl px-4 pb-16 pt-5">
        <nav className="-mx-4 mb-5 flex gap-1 overflow-x-auto border-b border-[var(--border)] px-4" role="tablist">
          {TABS.map((tb) => (
            <button key={tb.id} role="tab" aria-selected={tab === tb.id} onClick={() => setTab(tb.id)}
              className={`relative flex shrink-0 items-center gap-2 whitespace-nowrap px-3 pb-3 pt-1 text-[15px] font-bold transition-colors sm:px-4 ${tab === tb.id ? 'text-[var(--ink)]' : 'text-[var(--muted)] hover:text-[var(--ink)]'}`}>
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
                onDelete={askDelete} onRoute={goRoute} />
            ) : tab === 'mtr' ? (
              <MTRGuide t={t} lang={lang} initialDest={routeDest} />
            ) : (
              <BusPanel t={t} lang={lang} items={items} />
            )}
          </motion.div>
        </AnimatePresence>
      </main>

      <footer className="border-t border-[var(--border)] py-6 text-center text-xs text-[var(--muted)]">
        Kai Tak Transit &amp; Landmark Guide（原型 Prototype）
        <span className="mt-1 block">{fmt(t.dataVersion, { v: DATA_VERSION })}</span>
      </footer>

      <LoginModal open={loginOpen} onClose={() => setLoginOpen(false)} onSuccess={handleLoginSuccess} t={t} />
      <LandmarkForm open={formOpen} onClose={() => setFormOpen(false)} initial={editing} onSave={handleSave} t={t} lang={lang} />
      <ConfirmModal request={confirmReq} onClose={() => setConfirmReq(null)} t={t} />
      <SyncModal open={syncOpen} diff={diff} onClose={() => setSyncOpen(false)} onApply={handleSync} t={t} lang={lang} busy={syncBusy} />

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
