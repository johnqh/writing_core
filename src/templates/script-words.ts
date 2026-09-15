import type { TextDirection } from '../schema/vocab.js';

export const SCRIPT_LOCALES = ['en', 'es', 'fr', 'de', 'zh-Hans', 'zh-Hant', 'ja', 'ko'] as const;
export type ScriptLocale = (typeof SCRIPT_LOCALES)[number];

export interface ScriptWords {
  more: string;
  cont: string;
  sceneBottom: string;
  sceneTop: string;
  omitted: string;
  sceneIntros: string[];
  times: string[];
  extensions: string[];
  transitions: string[];
  timeSeparator: string;
  introSeparator: string;
  direction: TextDirection;
  credit: string;
}

/** Spec 01 §3.9 — the single source of script words per language (registry R30). */
export const LOCALE_SCRIPT_WORDS: Record<ScriptLocale, ScriptWords> = {
  en: {
    more: '(MORE)', cont: "(CONT'D)", sceneBottom: '(CONTINUED)', sceneTop: 'CONTINUED:', omitted: 'OMITTED',
    sceneIntros: ['INT.', 'EXT.', 'INT./EXT.'],
    times: ['DAY', 'NIGHT', 'MORNING', 'AFTERNOON', 'EVENING', 'LATER', 'MOMENTS LATER', 'CONTINUOUS', 'THE NEXT DAY'],
    extensions: ['(V.O.)', '(O.S.)', '(O.C.)', '(SUBTITLE)'],
    transitions: ['CUT TO:', 'FADE IN:', 'FADE OUT.', 'FADE TO:', 'DISSOLVE TO:', 'BACK TO:', 'MATCH CUT TO:', 'JUMP CUT TO:', 'FADE TO BLACK.'],
    timeSeparator: ' - ', introSeparator: ' ', direction: 'ltr', credit: 'Written by',
  },
  es: {
    more: '(MÁS)', cont: '(CONT.)', sceneBottom: '(CONTINÚA)', sceneTop: 'CONTINUACIÓN:', omitted: 'OMITIDA',
    sceneIntros: ['INT.', 'EXT.', 'INT./EXT.'],
    times: ['DÍA', 'NOCHE', 'MAÑANA', 'TARDE', 'ATARDECER', 'MÁS TARDE', 'MOMENTOS DESPUÉS', 'CONTINUO', 'AL DÍA SIGUIENTE'],
    extensions: ['(V.O.)', '(O.S.)', '(SUBTÍTULO)'],
    transitions: ['CORTE A:', 'FUNDIDO DE ENTRADA:', 'FUNDIDO DE SALIDA.', 'FUNDIDO A:', 'ENCADENADO A:', 'VOLVEMOS A:', 'CORTE POR SIMILITUD A:', 'CORTE BRUSCO A:', 'FUNDIDO A NEGRO.'],
    timeSeparator: ' - ', introSeparator: ' ', direction: 'ltr', credit: 'Escrito por',
  },
  fr: {
    more: '(À SUIVRE)', cont: '(SUITE)', sceneBottom: '(À SUIVRE)', sceneTop: 'SUITE :', omitted: 'SUPPRIMÉE',
    sceneIntros: ['INT.', 'EXT.', 'INT./EXT.'],
    times: ['JOUR', 'NUIT', 'MATIN', 'APRÈS-MIDI', 'SOIR', 'PLUS TARD', 'INSTANTS PLUS TARD', 'CONTINU', 'LE LENDEMAIN'],
    extensions: ['(V.O.)', '(OFF)', '(SOUS-TITRE)'],
    transitions: ['COUPE FRANCHE :', 'OUVERTURE EN FONDU :', 'FERMETURE EN FONDU.', 'FONDU VERS :', 'FONDU ENCHAÎNÉ :', 'RETOUR À :', 'RACCORD :', 'JUMP CUT :', 'FONDU AU NOIR.'],
    timeSeparator: ' - ', introSeparator: ' ', direction: 'ltr', credit: 'Écrit par',
  },
  de: {
    more: '(WEITER)', cont: '(FORTS.)', sceneBottom: '(FORTSETZUNG)', sceneTop: 'FORTSETZUNG:', omitted: 'ENTFÄLLT',
    sceneIntros: ['INNEN.', 'AUSSEN.', 'INNEN/AUSSEN.'],
    times: ['TAG', 'NACHT', 'MORGEN', 'NACHMITTAG', 'ABEND', 'SPÄTER', 'KURZ DARAUF', 'DURCHGEHEND', 'AM NÄCHSTEN TAG'],
    extensions: ['(V.O.)', '(OFF)', '(UNTERTITEL)'],
    transitions: ['SCHNITT:', 'AUFBLENDE:', 'ABBLENDE.', 'BLENDE AUF:', 'ÜBERBLENDUNG:', 'ZURÜCK ZU:', 'MATCH CUT:', 'JUMP CUT:', 'SCHWARZBLENDE.'],
    timeSeparator: ' - ', introSeparator: ' ', direction: 'ltr', credit: 'Drehbuch',
  },
  'zh-Hans': {
    more: '（未完）', cont: '（续）', sceneBottom: '（续下页）', sceneTop: '续：', omitted: '已删除',
    sceneIntros: ['内景', '外景', '内/外景'],
    times: ['日', '夜', '晨', '午后', '傍晚', '稍后', '片刻后', '连续', '次日'],
    extensions: ['（画外音）', '（画外）', '（字幕）'],
    transitions: ['切至：', '淡入：', '淡出。', '渐变至：', '叠化至：', '切回：', '匹配剪辑至：', '跳切至：', '渐黑。'],
    timeSeparator: ' · ', introSeparator: '', direction: 'ltr', credit: '编剧',
  },
  'zh-Hant': {
    more: '（未完）', cont: '（續）', sceneBottom: '（續下頁）', sceneTop: '續：', omitted: '已刪除',
    sceneIntros: ['內景', '外景', '內/外景'],
    times: ['日', '夜', '晨', '午後', '傍晚', '稍後', '片刻後', '連續', '次日'],
    extensions: ['（畫外音）', '（畫外）', '（字幕）'],
    transitions: ['切至：', '淡入：', '淡出。', '漸變至：', '溶至：', '切回：', '匹配剪接至：', '跳接至：', '漸黑。'],
    timeSeparator: ' · ', introSeparator: '', direction: 'ltr', credit: '編劇',
  },
  ja: {
    more: '（続く）', cont: '（続き）', sceneBottom: '（次頁へ続く）', sceneTop: '続き：', omitted: '削除',
    sceneIntros: ['屋内', '屋外', '屋内/屋外'],
    times: ['昼', '夜', '朝', '午後', '夕方', 'その後', '少し後', '続き', '翌日'],
    extensions: ['（N）', '（OFF）', '（字幕）'],
    transitions: ['カット：', 'フェードイン：', 'フェードアウト。', 'フェード：', 'ディゾルブ：', '戻って：', 'マッチカット：', 'ジャンプカット：', '暗転。'],
    timeSeparator: ' · ', introSeparator: '', direction: 'ltr', credit: '脚本',
  },
  ko: {
    more: '(계속)', cont: '(이어서)', sceneBottom: '(다음 장에 계속)', sceneTop: '계속:', omitted: '삭제됨',
    sceneIntros: ['실내.', '실외.', '실내/실외.'],
    times: ['낮', '밤', '아침', '오후', '저녁', '잠시 후', '조금 후', '연속', '다음 날'],
    extensions: ['(V.O.)', '(O.S.)', '(자막)'],
    transitions: ['컷:', '페이드 인:', '페이드 아웃.', '페이드:', '디졸브:', '다시:', '매치 컷:', '점프 컷:', '페이드 투 블랙.'],
    timeSeparator: ' - ', introSeparator: ' ', direction: 'ltr', credit: '각본',
  },
};
