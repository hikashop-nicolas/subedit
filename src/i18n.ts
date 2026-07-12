// Self-contained i18n so subedit is a complete multilingual product on its own. The
// locale is picked from the browser's preferred-languages list (base language, first
// match), English fallback. Add a language = add a dict to LOCALES; a host may force
// one via setLocale(). Placeholders like {n} are filled by t(key, { n }).

type Dict = Record<string, string>;

const en: Dict = {
  appName: "subedit",
  open: "Open subtitle file",
  save: "Save",
  loadVideo: "Load video / audio",
  noVideo: "No video loaded",
  loadVideoHint: "Load a video or audio file to preview and time your subtitles.",
  addCue: "Add cue",
  removeCue: "Remove cue",
  shiftTimes: "Shift all times…",
  fixOverlaps: "Fix overlaps",
  findReplace: "Find & replace…",
  cueList: "Cue list",
  colIndex: "#",
  colStart: "Start",
  colEnd: "End",
  colDuration: "Dur",
  colCps: "CPS",
  colText: "Text",
  noCues: "No cues yet. Add one to get started.",
  start: "Start",
  end: "End",
  duration: "Duration",
  text: "Text",
  style: "Style",
  styles: "Styles…",
  stylesEditor: "Styles",
  addStyle: "Add style",
  styleName: "Name",
  styleFont: "Font",
  styleSize: "Size",
  stylePrimary: "Fill",
  styleOutline: "Outline",
  styleAlign: "Align",
  duplicate: "Duplicate",
  delete: "Delete",
  close: "Close",
  selectCue: "Select a cue to edit it.",
  format: "Format",
  emptyTitle: "No subtitle file open",
  emptyHint: "Open an .srt or .vtt file, or start a new empty one.",
  newFile: "New empty file",
  shiftPrompt: "Shift all cues by how many milliseconds? (negative moves earlier)",
  cps: "characters per second",
  errRead: "This file could not be read as subtitles:",
  overlapsFixed: "Fixed {n} overlapping cue(s).",
  cueCount: "{n} cues",
  extractingWave: "Reading waveform…",
};

const fr: Dict = {
  appName: "subedit",
  open: "Ouvrir un fichier de sous-titres",
  save: "Enregistrer",
  loadVideo: "Charger une vidéo / un audio",
  noVideo: "Aucune vidéo chargée",
  loadVideoHint: "Chargez une vidéo ou un audio pour prévisualiser et caler vos sous-titres.",
  addCue: "Ajouter un sous-titre",
  removeCue: "Supprimer le sous-titre",
  shiftTimes: "Décaler tous les temps…",
  fixOverlaps: "Corriger les chevauchements",
  findReplace: "Rechercher et remplacer…",
  cueList: "Liste des sous-titres",
  colIndex: "N°",
  colStart: "Début",
  colEnd: "Fin",
  colDuration: "Durée",
  colCps: "CPS",
  colText: "Texte",
  noCues: "Aucun sous-titre. Ajoutez-en un pour commencer.",
  start: "Début",
  end: "Fin",
  duration: "Durée",
  text: "Texte",
  style: "Style",
  styles: "Styles…",
  stylesEditor: "Styles",
  addStyle: "Ajouter un style",
  styleName: "Nom",
  styleFont: "Police",
  styleSize: "Taille",
  stylePrimary: "Remplissage",
  styleOutline: "Contour",
  styleAlign: "Alignement",
  duplicate: "Dupliquer",
  delete: "Supprimer",
  close: "Fermer",
  selectCue: "Sélectionnez un sous-titre pour le modifier.",
  format: "Format",
  emptyTitle: "Aucun fichier de sous-titres ouvert",
  emptyHint: "Ouvrez un fichier .srt ou .vtt, ou créez-en un nouveau.",
  newFile: "Nouveau fichier vide",
  shiftPrompt: "Décaler tous les sous-titres de combien de millisecondes ? (négatif = plus tôt)",
  cps: "caractères par seconde",
  errRead: "Ce fichier n'a pas pu être lu comme des sous-titres :",
  overlapsFixed: "{n} chevauchement(s) corrigé(s).",
  cueCount: "{n} sous-titres",
  extractingWave: "Lecture de la forme d\u2019onde…",
};

const ja: Dict = {
  appName: "subedit",
  open: "字幕ファイルを開く",
  save: "保存",
  loadVideo: "動画 / 音声を読み込む",
  noVideo: "動画が読み込まれていません",
  loadVideoHint: "動画または音声を読み込むと、字幕をプレビューしてタイミングを合わせられます。",
  addCue: "字幕を追加",
  removeCue: "字幕を削除",
  shiftTimes: "全体の時間をずらす…",
  fixOverlaps: "重なりを修正",
  findReplace: "検索と置換…",
  cueList: "字幕リスト",
  colIndex: "番号",
  colStart: "開始",
  colEnd: "終了",
  colDuration: "長さ",
  colCps: "CPS",
  colText: "テキスト",
  noCues: "字幕がありません。追加して始めましょう。",
  start: "開始",
  end: "終了",
  duration: "長さ",
  text: "テキスト",
  style: "スタイル",
  styles: "スタイル…",
  stylesEditor: "スタイル",
  addStyle: "スタイルを追加",
  styleName: "名前",
  styleFont: "フォント",
  styleSize: "サイズ",
  stylePrimary: "塗り",
  styleOutline: "縁取り",
  styleAlign: "配置",
  duplicate: "複製",
  delete: "削除",
  close: "閉じる",
  selectCue: "編集する字幕を選択してください。",
  format: "形式",
  emptyTitle: "字幕ファイルが開かれていません",
  emptyHint: ".srt または .vtt ファイルを開くか、新規作成してください。",
  newFile: "新規ファイル",
  shiftPrompt: "すべての字幕を何ミリ秒ずらしますか？（負の値で早める）",
  cps: "1秒あたりの文字数",
  errRead: "このファイルを字幕として読み込めませんでした:",
  overlapsFixed: "{n} 件の重なりを修正しました。",
  cueCount: "{n} 件の字幕",
  extractingWave: "波形を読み込み中…",
};

const LOCALES: Record<string, Dict> = { en, fr, ja };

let current: Dict = en;

function detect(): Dict {
  const langs =
    typeof navigator !== "undefined"
      ? navigator.languages ?? [navigator.language]
      : [];
  for (const lang of langs) {
    const base = (lang || "").toLowerCase().split("-")[0];
    if (LOCALES[base]) return LOCALES[base];
  }
  return en;
}
current = detect();

// Force a specific locale (host override). Unknown codes fall back to English.
export function setLocale(code: string): void {
  const base = (code || "").toLowerCase().split("-")[0];
  current = LOCALES[base] ?? en;
}

export function t(key: string, vars?: Record<string, string | number>): string {
  let s = current[key] ?? en[key] ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, String(v));
  return s;
}
