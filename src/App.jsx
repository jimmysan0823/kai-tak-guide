/**
 * 啟德站周邊地標與交通轉乘指南 (Kai Tak Transit & Landmark Guide)
 * React + Tailwind CSS + lucide-react + framer-motion 單頁應用原型
 * 依賴：npm i react react-dom framer-motion lucide-react   （選用：@supabase/supabase-js）
 * 字型（建議放入 index.html）：Noto Sans HK、Barlow Semi Condensed（Google Fonts）
 */
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertTriangle, ArrowRight, Bus, CheckCircle2, Clock, Database, ExternalLink, Factory, Footprints, Globe, GraduationCap, HeartPulse, Home, Info, Landmark, LayoutGrid, Lock, LogOut, MapPin, Navigation, Pencil, Plus, RefreshCw, RotateCcw, Search, Ship, ShoppingBag, Ticket, Train, Trash2, Unlock, Wallet, X } from 'lucide-react';

/* =====================================================================
 *  Supabase 雲端資料庫預留層
 *  ---------------------------------------------------------------------
 *  部署步驟：
 *   1. npm i @supabase/supabase-js
 *   2. 取消下面兩行註解，並於 .env 填入 VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY
 *   3. 於 Supabase SQL Editor 建立資料表：
 *
 *   create table landmarks (
 *     id text primary key,
 *     category text not null,
 *     exit text not null,
 *     name jsonb not null,      -- {zh,en,ko,ja}
 *     "desc" jsonb not null,    -- {zh,en,ko,ja}
 *     tip jsonb,                -- {zh,en,ko,ja}
 *     map_query text,
 *     sort int default 0,
 *     updated_at timestamptz default now()
 *   );
 *   alter table landmarks enable row level security;
 *   create policy "public read" on landmarks for select using (true);
 *   create policy "admin write" on landmarks for all using (auth.role() = 'authenticated');
 *
 *  ⚠️ 正式環境請改用 Supabase Auth 取代前端寫死的 admin123 密碼。
 * ===================================================================== */
import { createClient } from '@supabase/supabase-js';
const supabase = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY);
const ADMIN_EMAIL = import.meta.env.VITE_ADMIN_EMAIL;

const LS_KEY = 'kat-landmarks-v1';
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
    async seedIfEmpty(seed) {
    if (!supabase) return false;
    const { count } = await supabase.from('landmarks').select('id', { count: 'exact', head: true });
    if (count === 0) {
      const { error } = await supabase.from('landmarks').insert(seed.map(toRow));
      if (error) throw error;
      return true;
    }
    return false;
  },
  reset() { try { localStorage.removeItem(LS_KEY); } catch {} },
};


const MTR_API = 'https://rt.data.gov.hk/v1/transport/mtr/getSchedule.php?line=TML&sta=KAT';
const TICKET_URL = 'https://www.mtr.com.hk/ch/customer/tickets/index.html';
const mapsUrl = (q) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;

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
const fmt = (s, v) => s.replace(/\{(\w+)\}/g, (_, k) => v[k] ?? '');
const tx = (obj, lang) => (obj && (obj[lang] || obj.en || obj.zh)) || '';

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

/* ============================ 地標 Mock Data ============================ */
// mk(id, 分類, 出口, [名稱 zh,en,ko,ja], [簡介 zh,en,ko,ja], [貼士 zh,en], Google Maps 關鍵字)
const mk = (id, category, exit, n, d, t, q) => ({
  id, category, exit,
  name: { zh: n[0], en: n[1], ko: n[2], ja: n[3] },
  desc: { zh: d[0], en: d[1], ko: d[2], ja: d[3] },
  tip: { zh: t[0], en: t[1] },
  mapQuery: q,
});

const SEED = [
  // 🛍️ 文娛/購物
  mk('airside', 'shopping', 'C', ['AIRSIDE', 'AIRSIDE', 'AIRSIDE', 'AIRSIDE'],
    ['啟德地標式商場，集購物、餐飲及天台花園。', 'Landmark mall with shopping, dining and a rooftop garden.', '쇼핑·다이닝·옥상 정원을 갖춘 랜드마크 몰.', 'ショッピング・グルメ・屋上庭園を備えたランドマークモール。'],
    ['C 出口經地下連接通道直達，步行約 3 分鐘。', 'Exit C via the underground link, about 3 min.'], 'AIRSIDE 啟德'),
  mk('mikiki', 'shopping', 'C', ['MIKIKI', 'MIKIKI', 'MIKIKI', 'MIKIKI'],
    ['鄰近新蒲崗的社區商場，設超市、戲院及多元食肆。', 'Community mall near San Po Kong with supermarket, cinema and eateries.', '슈퍼마켓·영화관·식당이 있는 커뮤니티 몰.', 'スーパー・映画館・飲食店が揃うモール。'],
    ['C 出口出站後沿太子道東方向步行約 6 分鐘。', 'From Exit C walk towards Prince Edward Road East, about 6 min.'], 'MIKIKI 新蒲崗'),
  mk('tst-mall', 'shopping', 'B2', ['天璽天 Mall', 'Tin Sai Tin Mall', '틴사이틴 몰', '天璽天 モール'],
    ['天璽天屋苑基座商場，提供日常購物及餐飲。', 'Podium mall of the Tin Sai Tin development for daily shopping and dining.', '단지 저층부 몰, 생활 쇼핑과 식당.', '住宅併設モール。日用品・飲食が充実。'],
    ['B2 出口直達商場入口。', 'Exit B2 leads straight to the mall entrance.'], '天璽天 啟德'),
  mk('sogo', 'shopping', 'B1', ['雙子匯1期 SOGO', 'SOGO Kai Tak (Twins Phase 1)', '소고 카이탁', 'そごう啓徳'],
    ['崇光百貨啟德店，涵蓋時裝、美妝及日式超市。', 'SOGO department store with fashion, beauty and a Japanese supermarket.', '패션·뷰티·일본식 슈퍼마켓을 갖춘 백화점.', 'ファッション・コスメ・日系スーパーを備えた百貨店。'],
    ['B1 出口經有蓋行人道步行約 4 分鐘。', 'Covered walkway from Exit B1, about 4 min.'], 'SOGO 啟德'),
  mk('twins2', 'shopping', 'A', ['雙子匯2期', 'Twins Phase 2', '트윈스 2기', '雙子匯 第2期'],
    ['雙子匯第二期商業及零售設施。', 'Phase 2 of the Twins commercial and retail complex.', '트윈스 2기 상업·리테일 시설.', '雙子匯第2期の商業施設。'],
    ['A 出口出站後右轉，步行約 5 分鐘。', 'Turn right after Exit A, about 5 min.'], '雙子匯 啟德'),
  mk('ching-long', 'shopping', 'A', ['晴朗商場', 'Ching Long Shopping Centre', '칭롱 쇼핑센터', '晴朗ショッピングセンター'],
    ['服務啟晴邨及德朗邨居民的屋邨商場，設街市及快餐店。', 'Estate mall for Kai Ching and Tak Long residents, with a wet market.', '공공주택 단지 쇼핑센터, 재래시장 포함.', '公営団地のショッピングセンター。市場あり。'],
    ['A 出口沿啟德車站廣場步行約 5 分鐘。', 'Walk through Kai Tak Station Square from Exit A, about 5 min.'], '晴朗商場'),
  mk('food-bay', 'shopping', 'D', ['美食海灣 / 啟德零售館', 'Food Bay / Kai Tak Mall', '푸드 베이 / 카이탁 몰', '美食海灣／啓徳リテール館'],
    ['啟德體育園內的零售及餐飲區，比賽日人流較多。', 'Retail and dining zone at Kai Tak Sports Park; busy on event days.', '카이탁 스포츠파크 내 상점·식당가.', '啓徳スポーツパーク内の飲食・物販エリア。'],
    ['D 出口經體育園連接通道步行約 8 分鐘。', 'From Exit D follow the Sports Park link, about 8 min.'], '啟德零售館'),

  // 🏠 住宅屋苑
  mk('kai-ching', 'residential', 'A', ['啟晴邨', 'Kai Ching Estate', '카이칭 단지', '啓晴邨'],
    ['啟德首批公共屋邨之一。', 'One of the first public housing estates in Kai Tak.', '카이탁 최초의 공공주택 단지 중 하나.', '啓徳最初期の公営住宅団地。'],
    ['A 出口經晴朗商場前往，步行約 7 分鐘。', 'From Exit A via Ching Long Shopping Centre, about 7 min.'], '啟晴邨'),
  mk('tak-long', 'residential', 'A', ['德朗邨', 'Tak Long Estate', '탁롱 단지', '德朗邨'],
    ['與啟晴邨相鄰的公共屋邨。', 'Public housing estate next to Kai Ching Estate.', '카이칭 단지 옆 공공주택.', '啓晴邨に隣接する公営団地。'],
    ['A 出口步行約 8 分鐘。', 'About 8 min from Exit A.'], '德朗邨'),
  mk('kai-long', 'residential', 'A', ['煥然壹居 / 啟朗苑', 'URA Kai Tak Flats / Kai Long Court', '분양주택 / 카이롱 코트', '煥然壹居／啓朗苑'],
    ['市建局資助出售房屋及居屋屋苑。', 'Subsidised sale flats by URA and HOS court.', '도시재생국 분양주택 및 HOS 단지.', '都市再生局の分譲住宅と公営分譲住宅。'],
    ['A 出口步行約 10 分鐘。', 'About 10 min from Exit A.'], '啟朗苑'),
  mk('tst-res', 'residential', 'B2', ['天璽天', 'Tin Sai Tin', '틴사이틴', '天璽天'],
    ['車站上蓋私人住宅發展項目。', 'Private residential development atop the station area.', '역 상부 민간 주거 단지.', '駅上部の民間住宅。'],
    ['B2 出口直達住宅大堂。', 'Exit B2 connects to the residential lobby.'], '天璽天 啟德'),
  mk('henley', 'residential', 'D', ['The Henley / Henley Park', 'The Henley / Henley Park', '더 헨리 / 헨리 파크', 'ザ・ヘンリー／ヘンリーパーク'],
    ['啟德跑道區沿岸私人住宅。', 'Private residences along the Kai Tak waterfront.', '카이탁 해안가 민간 주택.', '啓徳ウォーターフロントの民間住宅。'],
    ['D 出口步行約 10 分鐘，或於 D 出口交匯處轉乘小巴。', 'About 10 min from Exit D, or take a minibus from the Exit D PTI.'], 'The Henley Kai Tak'),
  mk('monaco', 'residential', 'D', ['MONACO / MONACO MARINE', 'MONACO / MONACO MARINE', '모나코 / 모나코 마린', 'MONACO／MONACO MARINE'],
    ['啟德跑道區私人住宅。', 'Private residences in the Kai Tak runway area.', '카이탁 활주로 지구 민간 주택.', '啓徳ランウェイ地区の民間住宅。'],
    ['D 出口轉乘 22 號巴士往跑道區方向最方便。', 'Easiest by bus 22 from Exit D towards the runway area.'], 'MONACO 啟德'),
  mk('lung-yue', 'residential', 'D', ['龍譽 / 天寰', 'Lung Yue / Tin Wan', '룽위 / 틴완', '龍譽／天寰'],
    ['D 出口一帶的私人住宅項目。', 'Private residential projects near Exit D.', 'D 출구 인근 민간 주택.', 'D出口周辺の民間住宅。'],
    ['D 出口步行約 6 至 8 分鐘。', '6 to 8 min from Exit D.'], '龍譽 啟德'),
  mk('choi-yee', 'residential', 'B1', ['采頤花園 / 景泰苑', 'Rhythm Garden / King Tai Court', '리듬 가든 / 킹타이 코트', '采頤花園／景泰苑'],
    ['新蒲崗區內住宅屋苑。', 'Residential estates in San Po Kong.', '산포콩 주거 단지.', '新蒲崗の住宅団地。'],
    ['B1 出口經天橋往新蒲崗，步行約 8 分鐘。', 'Footbridge from Exit B1 to San Po Kong, about 8 min.'], '采頤花園'),

  // 🏫 學校/教育
  mk('plk-hsn', 'education', 'A', ['保良局何壽南小學', 'PLK Ho Sau Nam Primary School', 'PLK 호사우남 초등학교', '保良局何壽南小学校'],
    ['啟德發展區內資助小學。', 'Aided primary school in the Kai Tak development.', '카이탁 개발구역 내 초등학교.', '啓徳開発区の小学校。'],
    ['A 出口步行約 8 分鐘。', 'About 8 min from Exit A.'], '保良局何壽南小學'),
  mk('skh-hc', 'education', 'A', ['聖公會聖十架小學', 'SKH Holy Cross Primary School', 'SKH 홀리크로스 초등학교', '聖公会聖十架小学校'],
    ['聖公會辦學的資助小學。', 'Aided primary school run by the Anglican church.', '성공회 운영 초등학교.', '聖公会運営の小学校。'],
    ['A 出口步行約 8 分鐘。', 'About 8 min from Exit A.'], '聖公會聖十架小學 啟德'),
  mk('man-lee', 'education', 'A', ['文理書院(九龍)', 'Man Lee College (Kowloon)', '만리 칼리지 (구룡)', '文理書院（九龍）'],
    ['區內中學。', 'Secondary school in the district.', '지역 중학교.', '地域の中学校。'],
    ['A 出口步行約 10 分鐘。', 'About 10 min from Exit A.'], '文理書院(九龍)'),
  mk('kt-gps', 'education', 'A', ['啟德官立小學', 'Kai Tak Government Primary School', '카이탁 공립 초등학교', '啓徳官立小学校'],
    ['啟德區官立小學。', 'Government primary school in Kai Tak.', '카이탁 공립 초등학교.', '啓徳の公立小学校。'],
    ['A 出口步行約 9 分鐘。', 'About 9 min from Exit A.'], '啟德官立小學'),
  mk('canossa', 'education', 'B1', ['嘉諾撒小學(新蒲崗)', 'Canossa Primary School (San Po Kong)', '카노사 초등학교 (산포콩)', '嘉諾撒小学校（新蒲崗）'],
    ['新蒲崗的天主教小學。', 'Catholic primary school in San Po Kong.', '산포콩 가톨릭 초등학교.', '新蒲崗のカトリック系小学校。'],
    ['B1 出口經天橋步行約 7 分鐘。', 'Footbridge from Exit B1, about 7 min.'], '嘉諾撒小學(新蒲崗)'),

  // 🏛️ 政府/公共
  mk('tid', 'government', 'C', ['工業貿易大樓', 'Trade and Industry Tower', '공업무역 빌딩', '工業貿易ビル'],
    ['工業貿易署等政府部門辦公大樓。', 'Government offices including the Trade and Industry Department.', '무역산업부 등 정부 청사.', '工業貿易署などの政府庁舎。'],
    ['C 出口步行約 5 分鐘。', 'About 5 min from Exit C.'], '工業貿易大樓 啟德'),
  mk('irc', 'government', 'C', ['稅務中心', 'Inland Revenue Centre', '국세청 센터', '税務センター'],
    ['稅務局總部所在地。', 'Headquarters of the Inland Revenue Department.', '국세청 본부.', '税務局本部。'],
    ['C 出口步行約 6 分鐘。', 'About 6 min from Exit C.'], '稅務中心 啟德'),
  mk('kerhq', 'government', 'B1', ['東九龍總區警察總部', 'Kowloon East Regional Police HQ', '동구룡 경찰본부', '東九龍地区警察本部'],
    ['東九龍總區警察總部及警署。', 'Regional police headquarters for Kowloon East.', '동구룡 지역 경찰본부.', '東九龍地区の警察本部。'],
    ['B1 出口步行約 6 分鐘。', 'About 6 min from Exit B1.'], '東九龍總區警察總部'),
  mk('kt-hall', 'government', 'C', ['啟德社區會堂', 'Kai Tak Community Hall', '카이탁 커뮤니티 홀', '啓徳コミュニティホール'],
    ['供區內團體舉辦活動的社區會堂。', 'Community hall for local events and activities.', '지역 행사용 커뮤니티 홀.', '地域イベント用のホール。'],
    ['C 出口步行約 7 分鐘。', 'About 7 min from Exit C.'], '啟德社區會堂'),
  mk('green-tl', 'government', 'A', ['綠在德朗', 'GREEN@TAK LONG', '그린@탁롱', '綠在德朗'],
    ['社區回收站，收集多類回收物。', 'Community recycling store for various recyclables.', '지역 재활용 센터.', '地域のリサイクルステーション。'],
    ['A 出口往德朗邨方向步行約 8 分鐘。', 'Towards Tak Long Estate from Exit A, about 8 min.'], '綠在德朗'),

  // 🏥 醫療/健康
  mk('hkch', 'medical', 'D', ['香港兒童醫院', "Hong Kong Children's Hospital", '홍콩 아동병원', '香港小児病院'],
    ['全港首間專科兒童醫院。', "Hong Kong's dedicated tertiary children's hospital.", '홍콩 최초의 아동 전문 병원.', '香港初の小児専門病院。'],
    ['D 出口轉乘 22M 巴士或步行約 15 分鐘。', 'Bus 22M from Exit D, or about 15 min on foot.'], '香港兒童醫院'),
  mk('kt-hosp', 'medical', 'D', ['啟德醫院', 'Kai Tak Hospital', '카이탁 병원', '啓徳病院'],
    ['已正式開幕營運的大型急症醫院。', 'Major acute hospital, now officially open.', '정식 개원한 대형 급성기 병원.', '正式開院した大型急性期病院。'],
    ['D 出口轉乘醫院專車或 22M 巴士直達。', 'Hospital shuttle or bus 22M from Exit D.'], '啟德醫院'),
  mk('robert-black', 'medical', 'C', ['柏立基普通科門診診所', 'Robert Black General Out-patient Clinic', '로버트 블랙 일반외래진료소', 'ロバート・ブラック一般外来診療所'],
    ['醫管局普通科門診。', 'Hospital Authority general out-patient clinic.', '병원관리국 일반 외래.', '病院管理局の一般外来。'],
    ['C 出口步行約 10 分鐘。', 'About 10 min from Exit C.'], '柏立基普通科門診診所'),

  // 🏭 工商業區
  mk('spk', 'industry', 'B1/B2', ['新蒲崗工業區', 'San Po Kong Business Area', '산포콩 상업지구', '新蒲崗ビジネスエリア'],
    ['工廈及辦公室集中地，亦有不少特色食肆。', 'Industrial and office buildings with plenty of local eateries.', '공업·오피스 빌딩과 맛집이 모인 지역.', '工業ビルとオフィスが集まり、飲食店も多い。'],
    ['B1 或 B2 出口經行人天橋前往，步行約 5 至 10 分鐘。', 'Via footbridge from Exit B1 or B2, 5 to 10 min.'], '新蒲崗'),
  mk('aia-kfc', 'industry', 'C', ['友邦九龍金融中心', 'AIA Kowloon Financial Centre', 'AIA 구룡 금융센터', 'AIA九龍金融センター'],
    ['甲級商業大廈。', 'Grade A office tower.', 'A급 오피스 빌딩.', 'グレードAオフィスビル。'],
    ['C 出口步行約 5 分鐘。', 'About 5 min from Exit C.'], '友邦九龍金融中心'),
  mk('emsd', 'industry', 'A', ['機電工程署總部大樓', 'EMSD Headquarters', '전기기계공정서 본부', '機電工程署本部ビル'],
    ['機電工程署總部，設教育徑供預約參觀。', 'EMSD headquarters with an education path open by appointment.', '전기기계공정서 본부, 예약 견학 가능.', '機電工程署本部。予約制の見学ルートあり。'],
    ['A 出口步行約 6 分鐘。', 'About 6 min from Exit A.'], '機電工程署總部大樓'),

  // 🚢 體育/景點
  mk('ktsp', 'sports', 'D', ['啟德體育園', 'Kai Tak Sports Park', '카이탁 스포츠파크', '啓徳スポーツパーク'],
    ['全港最大型體育及康樂設施。', "Hong Kong's largest sports and recreation venue.", '홍콩 최대 스포츠·레저 시설.', '香港最大のスポーツ・レジャー施設。'],
    ['D 出口有蓋通道直達，大型活動散場時請預留排隊時間。', 'Covered link from Exit D; allow extra time after big events.'], '啟德體育園'),
  mk('kt-stadium', 'sports', 'D', ['啟德主場館', 'Kai Tak Stadium', '카이탁 스타디움', '啓徳スタジアム'],
    ['可容納約五萬人的開合式上蓋主場館。', 'About 50,000-seat stadium with a retractable roof.', '개폐식 지붕의 약 5만 석 경기장.', '開閉式屋根の約5万人収容スタジアム。'],
    ['D 出口步行約 10 分鐘，跟隨體育園指示牌。', 'About 10 min from Exit D; follow Sports Park signs.'], '啟德主場館'),
  mk('kt-arena', 'sports', 'D', ['啟德體藝館', 'Kai Tak Arena', '카이탁 아레나', '啓徳アリーナ'],
    ['室內體育及文娛表演場館。', 'Indoor arena for sports and performances.', '실내 스포츠·공연장.', '屋内スポーツ・公演会場。'],
    ['D 出口步行約 8 分鐘。', 'About 8 min from Exit D.'], '啟德體藝館'),
  mk('kt-ysg', 'sports', 'D', ['啟德青年運動場', 'Kai Tak Youth Sports Ground', '카이탁 청소년 운동장', '啓徳ユーススポーツグラウンド'],
    ['設田徑跑道及足球場的公眾運動場。', 'Public ground with running track and football pitch.', '육상 트랙·축구장 공공 운동장.', 'トラックとサッカー場のある競技場。'],
    ['D 出口步行約 12 分鐘。', 'About 12 min from Exit D.'], '啟德青年運動場'),
  mk('cruise', 'sports', 'D', ['啟德郵輪碼頭', 'Kai Tak Cruise Terminal', '카이탁 크루즈 터미널', '啓徳クルーズターミナル'],
    ['國際郵輪碼頭，天台公園可欣賞維港景色。', 'International cruise terminal with a harbour-view rooftop park.', '항구 전망 옥상 공원이 있는 크루즈 터미널.', '港を望む屋上公園のあるクルーズターミナル。'],
    ['D 出口公共運輸交匯處轉乘 22／22M／22X 巴士。', 'Bus 22, 22M or 22X from the Exit D PTI.'], '啟德郵輪碼頭'),
  mk('station-sq', 'sports', 'A', ['啟德車站廣場', 'Kai Tak Station Square', '카이탁역 광장', '啓徳駅前広場'],
    ['車站上蓋的大型綠化休憩空間。', 'Large landscaped open space above the station.', '역 위의 대형 녹지 휴식 공간.', '駅上部の大規模な緑地広場。'],
    ['A 出口出站即達。', 'Right outside Exit A.'], '啟德車站廣場'),

  // 🚌 接駁交通
  mk('pti-d', 'transport', 'D', ['D 出口公共運輸交匯處', 'Exit D Public Transport Interchange', 'D 출구 대중교통 환승센터', 'D出口 公共交通ターミナル'],
    ['往跑道區、郵輪碼頭及九龍城碼頭的巴士與專線小巴總站。', 'Buses and minibuses to the runway area, cruise terminal and Kowloon City Pier.', '활주로 지구·크루즈 터미널·구룡성 부두행 버스·미니버스.', 'ランウェイ地区・クルーズターミナル・九龍城埠頭行きバス。'],
    ['往郵輪碼頭：22／22M／22X；往九龍城碼頭：可轉乘區內小巴。上車前請核對車頭目的地。', 'Cruise terminal: 22/22M/22X. Kowloon City Pier: local minibus. Check the destination sign before boarding.'], '啟德站 公共運輸交匯處'),
  mk('pti-a', 'transport', 'A', ['A 出口公共運輸交匯處', 'Exit A Public Transport Interchange', 'A 출구 대중교통 환승센터', 'A出口 公共交通ターミナル'],
    ['服務啟晴邨、德朗邨一帶的巴士及小巴站。', 'Bus and minibus stops serving Kai Ching and Tak Long estates.', '카이칭·탁롱 단지 버스·미니버스 정류장.', '啓晴邨・德朗邨方面のバス停。'],
    ['往觀塘、九龍城方向的巴士多於此上落。', 'Most buses towards Kwun Tong and Kowloon City stop here.'], '德朗邨 巴士總站'),
];

/* ============================ 港鐵：目的地與車費 ============================ */
const LINES = {
  TML: { color: '#9A3B26', zh: '屯馬綫', en: 'Tuen Ma Line' },
  KTL: { color: '#00AB4E', zh: '觀塘綫', en: 'Kwun Tong Line' },
  EAL: { color: '#5EB6E4', zh: '東鐵綫', en: 'East Rail Line' },
  TWL: { color: '#E2231A', zh: '荃灣綫', en: 'Tsuen Wan Line' },
  TCL: { color: '#F7943E', zh: '東涌綫', en: 'Tung Chung Line' },
  AEL: { color: '#00888A', zh: '機場快綫', en: 'Airport Express' },
  DRL: { color: '#F550A6', zh: '迪士尼綫', en: 'Disneyland Resort Line' },
  WALK: { color: '#8A939E', zh: '步行', en: 'Walk' },
};
// pass: 'free' = 全程在全月通加強版範圍內；'disc' = 範圍外路程 75 折
const DESTS = [
  { id: 'tst', name: { zh: '尖沙咀', en: 'Tsim Sha Tsui', ko: '침사추이', ja: '尖沙咀' }, oct: 11.2, single: 12.5, mins: 15, pass: 'free',
    steps: [{ l: 'TML', zh: '往屯門方向至尖東站', en: 'Towards Tuen Mun to East Tsim Sha Tsui' }, { l: 'WALK', zh: '經行人隧道往尖沙咀站，約 5 分鐘', en: 'Subway walk to Tsim Sha Tsui, ~5 min' }] },
  { id: 'central', name: { zh: '中環', en: 'Central', ko: '센트럴', ja: '中環' }, oct: 16.1, single: 17.5, mins: 22, pass: 'disc',
    steps: [{ l: 'TML', zh: '往屯門方向至紅磡', en: 'Towards Tuen Mun to Hung Hom' }, { l: 'EAL', zh: '轉東鐵綫往金鐘', en: 'East Rail Line to Admiralty' }, { l: 'TWL', zh: '轉荃灣綫至中環', en: 'Tsuen Wan Line to Central' }] },
  { id: 'mk', name: { zh: '旺角', en: 'Mong Kok', ko: '몽콕', ja: '旺角' }, oct: 9.4, single: 10.5, mins: 12, pass: 'disc',
    steps: [{ l: 'TML', zh: '往屯門方向至何文田', en: 'Towards Tuen Mun to Ho Man Tin' }, { l: 'KTL', zh: '轉觀塘綫往調景嶺方向至旺角', en: 'Kwun Tong Line towards Tiu Keng Leng to Mong Kok' }] },
  { id: 'kt', name: { zh: '觀塘', en: 'Kwun Tong', ko: '쿤통', ja: '観塘' }, oct: 7.6, single: 8.5, mins: 14, pass: 'disc',
    steps: [{ l: 'TML', zh: '往烏溪沙方向至鑽石山', en: 'Towards Wu Kai Sha to Diamond Hill' }, { l: 'KTL', zh: '轉觀塘綫往調景嶺方向至觀塘', en: 'Kwun Tong Line towards Tiu Keng Leng to Kwun Tong' }] },
  { id: 'airport', name: { zh: '機場', en: 'Airport', ko: '공항', ja: '空港' }, oct: 70.5, single: 72.0, mins: 48, pass: 'disc',
    steps: [{ l: 'TML', zh: '往屯門方向至南昌', en: 'Towards Tuen Mun to Nam Cheong' }, { l: 'TCL', zh: '轉東涌綫至青衣', en: 'Tung Chung Line to Tsing Yi' }, { l: 'AEL', zh: '轉機場快綫至機場', en: 'Airport Express to Airport' }] },
  { id: 'disney', name: { zh: '迪士尼', en: 'Disneyland', ko: '디즈니랜드', ja: 'ディズニー' }, oct: 21.6, single: 23.5, mins: 40, pass: 'disc',
    steps: [{ l: 'TML', zh: '往屯門方向至南昌', en: 'Towards Tuen Mun to Nam Cheong' }, { l: 'TCL', zh: '轉東涌綫至欣澳', en: 'Tung Chung Line to Sunny Bay' }, { l: 'DRL', zh: '轉迪士尼綫至迪士尼', en: 'Disneyland Resort Line to Disneyland Resort' }] },
];

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
  const label = lang === 'zh' || lang === 'ja' ? l.zh : l.en;
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

function LandmarkPortal({ items, lang, t, isAdmin, onAdd, onEdit, onDelete, onReset }) {
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
          <div className="flex gap-2">
            <button onClick={onAdd} className="flex items-center justify-center gap-1.5 rounded-xl px-4 py-3 text-sm font-bold text-white" style={{ background: LINES.TML.color }}>
              <Plus size={17} />{t.addNew}
            </button>
            <button onClick={onReset} title={t.reset} aria-label={t.reset} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-[var(--muted)] hover:text-[var(--ink)]"><RotateCcw size={16} /></button>
          </div>
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
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 5000);
      const res = await fetch(MTR_API, { signal: ctrl.signal });
      clearTimeout(timer);
      const j = await res.json();
      const s = j && j.data && j.data['TML-KAT'];
      if (!s) throw new Error('no data');
      const conv = (arr) => (arr || []).map((x) => ({ dest: x.dest, plat: x.plat, at: new Date(x.time.replace(' ', 'T') + '+08:00').getTime() }));
      setLive({ up: conv(s.UP), down: conv(s.DOWN), updated: Date.now() });
      setStatus('live');
    } catch {
      setStatus('sim');
    }
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

function FareCalculator({ t, lang }) {
  const [sel, setSel] = useState('central');
  const d = DESTS.find((x) => x.id === sel);
  return (
    <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-5">
      <h2 className="flex items-center gap-2 text-lg font-bold"><Wallet size={19} />{t.fareCalc}</h2>
      <p className="mt-1 text-sm text-[var(--muted)]">{t.from}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {DESTS.map((x) => (
          <button key={x.id} onClick={() => setSel(x.id)}
            className={`rounded-lg border px-3.5 py-2 text-sm font-semibold transition-colors ${sel === x.id ? 'border-transparent text-white' : 'border-[var(--border)] hover:border-[var(--ink)]'}`}
            style={sel === x.id ? { background: LINES.TML.color } : undefined}>
            {tx(x.name, lang)}
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait">
        <motion.div key={sel} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.2 }}
          className="mt-5 grid gap-5 md:grid-cols-[1.4fr_1fr]">
          <div>
            <h3 className="mb-3 text-sm font-semibold text-[var(--muted)]">{t.route}</h3>
            <ol className="relative">
              <li className="flex items-center gap-3 pb-4">
                <ExitPlate exit="KAT" />
                <span className="text-sm font-bold">{lang === 'zh' || lang === 'ja' ? '啟德' : 'Kai Tak'}</span>
              </li>
              {d.steps.map((s, i) => (
                <li key={i} className="relative flex gap-3 pb-4 pl-[0.85rem]">
                  <div className="absolute bottom-0 left-[0.85rem] top-0 w-1 -translate-x-1/2 rounded-full" style={{ background: LINES[s.l].color, opacity: s.l === 'WALK' ? 0.5 : 1 }} />
                  <div className="ml-5 flex flex-col gap-1">
                    <LineChip code={s.l} lang={lang} />
                    <span className="text-sm">{lang === 'zh' ? s.zh : s.en}</span>
                  </div>
                </li>
              ))}
              <li className="flex items-center gap-3">
                <div className="flex h-7 w-7 items-center justify-center rounded-full border-[3px] bg-[var(--surface)]" style={{ borderColor: LINES[d.steps[d.steps.length - 1].l].color }} />
                <span className="text-sm font-bold">{tx(d.name, lang)}</span>
              </li>
            </ol>
          </div>
          <div className="flex flex-col gap-2">
            {[
              { k: t.octopus, v: `$${d.oct.toFixed(1)}`, big: true },
              { k: t.single, v: `$${d.single.toFixed(1)}` },
              { k: t.time, v: `${d.mins} ${t.mins}` },
            ].map((r) => (
              <div key={r.k} className="flex items-baseline justify-between rounded-lg bg-[var(--surface-2)] px-4 py-3">
                <span className="text-sm text-[var(--muted)]">{r.k}</span>
                <span className={`num font-bold ${r.big ? 'text-3xl' : 'text-xl'}`}>{r.v}</span>
              </div>
            ))}
            <div className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold" style={{ background: 'var(--tml-soft)', color: 'var(--tml)' }}>
              <Ticket size={14} />{d.pass === 'free' ? t.passFree : t.passDisc}
            </div>
            <p className="text-xs text-[var(--muted)]">{t.fareNote}</p>
          </div>
        </motion.div>
      </AnimatePresence>
    </section>
  );
}

const TICKETS = {
  zh: [
    { key: 'mp', title: '全月通 加強版（尖東 – 烏溪沙）', flag: '啟德站位處本全月通指定覆蓋範圍內！',
      body: ['有效月份內無限次免費乘搭屯馬綫尖東至烏溪沙段（包括啟德、鑽石山、紅磡等站）。', '連接指定範圍以外的路程（例如過海往金鐘、中環），正價車費可享 75 折（25% OFF）優惠。'] },
    { key: 'cs', title: '港鐵都會票（MTR City Saver）',
      body: ['40 天內可乘搭 40 程港鐵市區綫（包括啟德站）。', '適合經常跨區長途乘車的乘客，每程車費固定。'] },
    { key: 'tdp', title: '遊客全日通（Tourist Day Pass）', warn: '啟德站現場不設發售',
      body: ['請預先於 MTR Mobile App／港鐵官網預訂，或前往設有指定客務中心的主要車站（如機場站、西九龍站、邊境車站）購買。', '購票後可於啟德站正常感應入閘使用。'] },
  ],
  en: [
    { key: 'mp', title: 'Monthly Pass Extra (East TST – Wu Kai Sha)', flag: 'Kai Tak is inside this pass\'s coverage zone!',
      body: ['Unlimited free rides on the Tuen Ma Line between East Tsim Sha Tsui and Wu Kai Sha (incl. Kai Tak, Diamond Hill, Hung Hom) during the valid month.', 'Journeys extending beyond the zone (e.g. cross-harbour to Admiralty or Central) get 25% off the regular fare.'] },
    { key: 'cs', title: 'MTR City Saver',
      body: ['40 rides on MTR urban lines (incl. Kai Tak) within 40 days.', 'Fixed per-ride cost, good for frequent long-distance riders.'] },
    { key: 'tdp', title: 'Tourist Day Pass', warn: 'Not sold at Kai Tak Station',
      body: ['Book in advance on the MTR Mobile app or website, or buy at a station with a designated Customer Service Centre (e.g. Airport, West Kowloon, boundary stations).', 'Once bought, tap in at Kai Tak as normal.'] },
  ],
};
TICKETS.ko = TICKETS.en; TICKETS.ja = TICKETS.en;

function TicketZone({ t, lang }) {
  const list = TICKETS[lang];
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
          <ul className="mt-2 space-y-1.5 text-sm">
            <li className="flex items-center gap-2"><ExitPlate exit="A" /><ExitPlate exit="B" />
              <span>{lang === 'zh' ? '客務中心：位於大堂近 A／B 出口' : 'Customer Service Centre: concourse near Exits A/B'}</span></li>
            <li className="flex items-center gap-2"><Ticket size={16} className="mx-1.5" />
              <span>{lang === 'zh' ? '自動售票機：可購買單程車票及為八達通增值' : 'Ticket machines: single journey tickets and Octopus top-up'}</span></li>
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

function MTRGuide({ t, lang }) {
  return (
    <div className="space-y-4">
      <Arrivals t={t} lang={lang} />
      <FareCalculator t={t} lang={lang} />
      <TicketZone t={t} lang={lang} />
    </div>
  );
}

/* ============================ 管理員 Modal ============================ */
function LoginModal({ open, onClose, onSuccess, t }) {
  const [pw, setPw] = useState('');
  const [err, setErr] = useState(false);
  useEffect(() => { if (open) { setPw(''); setErr(false); } }, [open]);
  const submit = async () => {
    if (supabase) {
      const { error } = await supabase.auth.signInWithPassword({ email: ADMIN_EMAIL, password: pw });
      if (error) { setErr(true); return; }
    } else if (pw !== ADMIN_PASSWORD) { setErr(true); return; }
    onSuccess(); onClose();
  };
  return (
    <Modal open={open} onClose={onClose}>
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-lg font-bold"><Lock size={18} />{t.admin}</h2>
        <button onClick={onClose} aria-label="Close" className="rounded p-1 text-[var(--muted)] hover:text-[var(--ink)]"><X size={18} /></button>
      </div>
      <motion.div animate={err ? { x: [0, -8, 8, -5, 5, 0] } : {}} transition={{ duration: 0.35 }}>
        <input type="password" autoFocus value={pw} onChange={(e) => { setPw(e.target.value); setErr(false); }}
          onKeyDown={(e) => e.key === 'Enter' && submit()} placeholder={t.pwPh}
          className={`mt-4 w-full rounded-lg border bg-[var(--surface-2)] px-3 py-2.5 outline-none ${err ? 'border-red-500' : 'border-[var(--border)] focus:border-[var(--ink)]'}`} />
      </motion.div>
      {err && <p className="mt-2 text-sm text-red-600">{t.pwWrong}</p>}
      <button onClick={submit} className="mt-4 w-full rounded-lg py-2.5 font-bold text-white" style={{ background: LINES.TML.color }}>{t.login}</button>
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

function ConfirmModal({ item, onClose, onConfirm, t, lang }) {
  return (
    <Modal open={!!item} onClose={onClose}>
      {item && (
        <>
          <div className="flex items-start gap-3">
            <div className="rounded-full bg-red-100 p-2 text-red-600"><Trash2 size={18} /></div>
            <p className="text-sm leading-relaxed">{fmt(t.confirmDel, { name: tx(item.name, lang) })}</p>
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <button onClick={onClose} className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm font-medium">{t.cancel}</button>
            <button onClick={() => onConfirm(item)} className="rounded-lg bg-red-600 px-4 py-2 text-sm font-bold text-white">{t.del}</button>
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
  const [toDelete, setToDelete] = useState(null);
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
    setToDelete(null);
    try { await db.remove(item.id, next); setToast(t.deleted); } catch (e) { setToast(String(e.message || e)); }
  };
  const handleReset = () => { db.reset(); setItems(SEED); setToast(t.reset); };

  const TABS = [
    { id: 'land', label: t.tabLand, Icon: MapPin },
    { id: 'mtr', label: t.tabMtr, Icon: Train },
  ];

  return (
    <div className="min-h-full bg-[var(--bg)] text-[var(--ink)]">
      <style>{GLOBAL_CSS}</style>
      <Header lang={lang} setLang={setLang} t={t} isAdmin={isAdmin} onAdminClick={() => setLoginOpen(true)} onLogout={() => { supabase?.auth.signOut(); setIsAdmin(false); }} />

      <AnimatePresence>
        {isAdmin && (
          <motion.div initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }} className="overflow-hidden bg-[var(--sign)] text-[#111418]">
            <div className="mx-auto flex max-w-6xl items-center justify-between gap-2 px-4 py-2 text-sm font-semibold">
              <span className="flex items-center gap-2"><Unlock size={15} />{t.adminOn}</span>
              <span className="flex items-center gap-1.5 text-xs font-medium"><Database size={13} />{db.mode === 'cloud' ? t.storeCloud : t.storeLocal}</span>
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
                onDelete={(it) => setToDelete(it)}
                onReset={handleReset} />
            ) : (
              <MTRGuide t={t} lang={lang} />
            )}
          </motion.div>
        </AnimatePresence>
      </main>

      <footer className="border-t border-[var(--border)] py-6 text-center text-xs text-[var(--muted)]">
        Kai Tak Transit &amp; Landmark Guide（原型 Prototype）
      </footer>

      <LoginModal open={loginOpen} onClose={() => setLoginOpen(false)} t={t}onSuccess={async () => {setIsAdmin(true);try { if (await db.seedIfEmpty(SEED)) setToast('已上載預設資料'); } catch (e) { setToast(e.message); }}} />
      <LandmarkForm open={formOpen} onClose={() => setFormOpen(false)} initial={editing} onSave={handleSave} t={t} lang={lang} />
      <ConfirmModal item={toDelete} onClose={() => setToDelete(null)} onConfirm={handleDelete} t={t} lang={lang} />

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
