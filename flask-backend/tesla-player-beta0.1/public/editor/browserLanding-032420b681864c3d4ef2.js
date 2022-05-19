/******/ (() => { // webpackBootstrap
/******/ 	// The require scope
/******/ 	var __webpack_require__ = {};
/******/ 	
/************************************************************************/
/******/ 	/* webpack/runtime/global */
/******/ 	(() => {
/******/ 		__webpack_require__.g = (function() {
/******/ 			if (typeof globalThis === 'object') return globalThis;
/******/ 			try {
/******/ 				return this || new Function('return this')();
/******/ 			} catch (e) {
/******/ 				if (typeof window === 'object') return window;
/******/ 			}
/******/ 		})();
/******/ 	})();
/******/ 	
/************************************************************************/
var __webpack_exports__ = {};
// This entry need to be wrapped in an IIFE because it need to be isolated against other entry modules.
(() => {
var _global = (typeof window !== 'undefined' ? window : typeof __webpack_require__.g !== 'undefined' ? __webpack_require__.g : typeof self !== 'undefined' ? self : {}); _global.SENTRY_RELEASE={id:"fe72764ba2a6bdb0268dc0863b5b42204853acc4"};
      _global.SENTRY_RELEASES=_global.SENTRY_RELEASES || {};
      _global.SENTRY_RELEASES["signal@codingcafe_jp"]={id:"fe72764ba2a6bdb0268dc0863b5b42204853acc4"};
      
})();

// This entry need to be wrapped in an IIFE because it need to be in strict mode.
(() => {
"use strict";

;// CONCATENATED MODULE: ./src/common/localize/localization.ts
/* harmony default export */ const localization = ({
  ja: {
    "app-intro": "オープンソースのオンラインMIDIエディタ",
    "app-desc": "何もインストールせずに作曲を始めよう",
    launch: "起動",
    platform: "対応ブラウザ (デスクトップ版のみ): Google Chrome / Firefox / Safari",
    features: "機能",
    "feature-midi-file": "フル機能のMIDIエディター",
    "feature-midi-file-description": "複数トラックに対応したピアノロールエディタを使って、自在に作曲しましょう。もちろんベロシティやピッチベンド、エクスプレッション、モジュレーションを使った豊かな表現ができます。",
    "feature-gm-module": "GM互換音源搭載",
    "feature-gm-module-description": "WebAudio APIとAudioWorkletで作られた専用の音源モジュールにより、ブラウザ上で大量のMIDIノートを鳴らすことが可能になりました。",
    "piano-roll": "ピアノロール",
    tempo: "テンポ",
    "tempo-track": "テンポトラック",
    "feature-time-signature": "4/4以外の拍子・テンポチェンジに対応",
    "feature-time-signature-description": "グラフエディタを使って、曲の途中でテンポや拍子を自由に変えることができます。",
    "feature-pwa": "PWA対応",
    "feature-pwa-description": "アドレスバーが邪魔ですか？アプリとしてインストールすることができます。",
    "feature-export-wav": "WAVファイルへの書き出し",
    "feature-midi-io": "MIDI入出力",
    "feature-midi-io-description": "Web MIDI APIに対応したブラウザでは、MIDIキーボードを接続して演奏を録音したり、ハードウェアシンセで音を鳴らしたりすることができます。",
    "feature-export-audio": "高速オーディオ書き出し機能",
    "feature-export-audio-description": "作った曲をWAVファイルに書き出して、スマートフォンで聴いたり動画のBGMに使ったり、DAWに取り込んだりすることができます。",
    "time-signature": "拍子",
    "add-time-signature": "拍子を追加",
    "remove-time-signature": "拍子を削除",
    support: "サポート",
    "sponsor-intro": "signalは週末に趣味で作っているアプリです。もしブラウザで動作する軽量な作曲ソフトというコンセプトに共感してもらえたら、ぜひご支援ください。",
    "support-github-desctiption": "GitHubで不具合報告や要望を送る",
    "become-sponsor": "スポンサーになりませんか？",
    "open-github-sponsors": "GitHub Sponsorsを開く",
    "follow-twitter": "Twitterで更新情報を確認する",
    file: "ファイル",
    "new-song": "新規作成",
    "open-song": "開く",
    "save-song": "保存",
    "save-as": "名前を付けて保存",
    track: "トラック",
    tracks: "トラック",
    "add-track": "トラックを追加",
    "delete-track": "トラックを削除",
    "duplicate-track": "トラックを複製",
    channel: "チャンネル",
    categories: "カテゴリ",
    instruments: "楽器",
    "rhythm-track": "リズムトラック",
    "conductor-track": "コンダクタートラック",
    "track-name": "トラック名",
    cancel: "キャンセル",
    ok: "OK",
    triplet: "三連符",
    dotted: "付点",
    "confirm-new": "編集中の楽曲が破棄されます。本当に新規作成しますか？",
    "confirm-close": "編集中の楽曲が破棄されます。本当にページを閉じますか？",
    "auto-scroll": "自動でスクロール",
    help: "ヘルプ",
    close: "閉じる",
    "keyboard-shortcut": "キーボードショートカット",
    "play-pause": "再生・一時停止",
    rewind: "巻戻し",
    "fast-forward": "早送り",
    "forward-rewind": "早送り・巻き戻し",
    "next-previous-track": "次のトラック・前のトラック",
    "solo-mute-ghost": "ソロ・ミュート・ゴーストトラックの切り替え",
    stop: "停止",
    record: "録音",
    "pencil-tool": "鉛筆ツール",
    "selection-tool": "選択ツール",
    "copy-selection": "選択範囲をコピー",
    "cut-selection": "選択範囲を切り取り",
    "paste-selection": "コピーした選択範囲を現在位置に貼り付け",
    "delete-selection": "選択範囲を削除",
    "move-selection": "選択範囲を移動",
    undo: "元に戻す",
    redo: "やり直し",
    cut: "切り取り",
    copy: "コピー",
    paste: "ペースト",
    duplicate: "複製",
    delete: "削除",
    "select-note": "ノートを選択",
    "scroll-horizontally": "左右にスクロール",
    "scroll-vertically": "上下にスクロール",
    settings: "設定",
    "midi-settings": "MIDI設定",
    inputs: "入力",
    outputs: "出力",
    "one-octave-up": "+1オクターブ",
    "one-octave-down": "-1オクターブ",
    arrange: "アレンジ",
    "arrangement-view": "アレンジビュー",
    "open-help": "ヘルプを開く",
    "event-list": "イベントリスト",
    "open-chat": "チャットを開く",
    property: "プロパティ",
    quantize: "クオンタイズ",
    "snap-to-grid": "グリッドにスナップ",
    "export-audio": "オーディオ書き出し",
    export: "書き出し",
    "exporting-audio": "オーディオを書き出し中...",
    "file-type": "ファイル形式",
    "export-error-too-short": "曲が短すぎます",
    "set-loop-start": "ループ開始位置を設定",
    "set-loop-end": "ループ終了位置を設定",
    Piano: "ピアノ",
    "Chromatic Percussion": "クロマチック",
    Organ: "オルガン",
    Guitar: "ギター",
    Bass: "ベース",
    Strings: "ストリングス",
    Ensemble: "アンサンブル",
    Brass: "ブラス",
    Reed: "リード",
    Pipe: "笛",
    "Synth Lead": "シンセリード",
    "Synth Pad": "シンセパッド",
    "Synth Effects": "シンセエフェクト",
    Ethnic: "民族楽器",
    Percussive: "打楽器",
    "Sound effects": "効果音",
    "Acoustic Grand Piano": "アコースティックピアノ",
    "Bright Acoustic Piano": "ブライトピアノ",
    "Electric Grand Piano": "エレクトリック・グランドピアノ",
    "Honky-tonk Piano": "ホンキートンクピアノ",
    "Electric Piano 1": "エレクトリックピアノ",
    "Electric Piano 2": "FMエレクトリックピアノ",
    Harpsichord: "ハープシコード",
    Clavinet: "クラビネット",
    Celesta: "チェレスタ",
    Glockenspiel: "グロッケンシュピール",
    "Music Box": "オルゴール",
    Vibraphone: "ヴィブラフォン",
    Marimba: "マリンバ",
    Xylophone: "木琴",
    "Tubular Bells": "チューブラーベル",
    Dulcimer: "ダルシマー",
    "Drawbar Organ": "ドローバーオルガン",
    "Percussive Organ": "パーカッシブオルガン",
    "Rock Organ": "ロックオルガン",
    "Church Organ": "チャーチオルガン",
    "Reed Organ": "リードオルガン",
    Accordion: "アコーディオン",
    Harmonica: "ハーモニカ",
    "Tango Accordion": "タンゴアコーディオン",
    "Acoustic Guitar (nylon)": "アコースティックギター（ナイロン弦）",
    "Acoustic Guitar (steel)": "アコースティックギター（スチール弦）",
    "Electric Guitar (jazz)": "ジャズギター",
    "Electric Guitar (clean)": "クリーンギター",
    "Electric Guitar (muted)": "ミュートギター",
    "Overdriven Guitar": "オーバードライブギター",
    "Distortion Guitar": "ディストーションギター",
    "Guitar Harmonics": "ギターハーモニクス",
    "Acoustic Bass": "アコースティックベース",
    "Electric Bass (finger)": "フィンガーベース",
    "Electric Bass (pick)": "ピックベース",
    "Fretless Bass": "フレットレスベース",
    "Slap Bass 1": "スラップベース 1",
    "Slap Bass 2": "スラップベース 2",
    "Synth Bass 1": "シンセベース 1",
    "Synth Bass 2": "シンセベース 2",
    Violin: "ヴァイオリン",
    Viola: "ヴィオラ",
    Cello: "チェロ",
    Contrabass: "コントラバス",
    "Tremolo Strings": "トレモロストリングス",
    "Pizzicato Strings": "ピッツィカートストリングス",
    "Orchestral Harp": "ハープ",
    Timpani: "ティンパニ",
    "String Ensemble 1": "ストリングアンサンブル",
    "String Ensemble 2": "スローストリングアンサンブル",
    "Synth Strings 1": "シンセストリングス",
    "Synth Strings 2": "シンセストリングス2",
    "Choir Aahs": "声「アー」",
    "Voice Oohs": "声「ドゥー」",
    "Synth Choir": "シンセヴォイス",
    "Orchestra Hit": "オーケストラヒット",
    Trumpet: "トランペット",
    Trombone: "トロンボーン",
    Tuba: "チューバ",
    "Muted Trumpet": "ミュートトランペット",
    "French Horn": "フレンチ・ホルン",
    "Brass Section": "ブラスセクション",
    "Synth Brass 1": "シンセブラス 1",
    "Synth Brass 2": "シンセブラス 2",
    "Soprano Sax": "ソプラノサックス",
    "Alto Sax": "アルトサックス",
    "Tenor Sax": "テナーサックス",
    "Baritone Sax": "バリトンサックス",
    Oboe: "オーボエ",
    "English Horn": "イングリッシュホルン",
    Bassoon: "ファゴット",
    Clarinet: "クラリネット",
    Piccolo: "ピッコロ",
    Flute: "フルート",
    Recorder: "リコーダー",
    "Pan Flute": "パンフルート",
    "Blown Bottle": "ブロウンボトル",
    Shakuhachi: "尺八",
    Whistle: "口笛",
    Ocarina: "オカリナ",
    "Lead 1 (square)": "正方波",
    "Lead 2 (sawtooth)": "ノコギリ波",
    "Lead 3 (calliope)": "カリオペリード",
    "Lead 4 (chiff)": "チフリード",
    "Lead 5 (charang)": "チャランゴリード",
    "Lead 6 (voice)": "ボイスリード",
    "Lead 7 (fifths)": "フィフスズリード",
    "Lead 8 (bass + lead)": "ベース + リード",
    "Pad 1 (new age)": "ファンタジア",
    "Pad 2 (warm)": "ウォーム",
    "Pad 3 (polysynth)": "ポリシンセ",
    "Pad 4 (choir)": "クワイア",
    "Pad 5 (bowed)": "ボウ",
    "Pad 6 (metallic)": "メタリック",
    "Pad 7 (halo)": "ハロー",
    "Pad 8 (sweep)": "スウィープ",
    "FX 1 (rain)": "雨",
    "FX 2 (soundtrack)": "サウンドトラック",
    "FX 3 (crystal)": "クリスタル",
    "FX 4 (atmosphere)": "アトモスフィア",
    "FX 5 (brightness)": "ブライトネス",
    "FX 6 (goblins)": "ゴブリン",
    "FX 7 (echoes)": "エコー",
    "FX 8 (sci-fi)": "サイファイ",
    Sitar: "シタール",
    Banjo: "バンジョー",
    Shamisen: "三味線",
    Koto: "琴",
    Kalimba: "カリンバ",
    Bagpipe: "バグパイプ",
    Fiddle: "フィドル",
    Shanai: "シャハナーイ",
    "Tinkle Bell": "ティンクルベル",
    Agogo: "アゴゴ",
    "Steel Drums": "スチールドラム",
    Woodblock: "ウッドブロック",
    "Taiko Drum": "太鼓",
    "Melodic Tom": "メロディックタム",
    "Synth Drum": "シンセドラム",
    "Reverse Cymbal": "リバースシンバル",
    "Guitar Fret Noise": "ギターフレットノイズ",
    "Breath Noise": "ブレスノイズ",
    Seashore: "海岸",
    "Bird Tweet": "鳥のさえずり",
    "Telephone Ring": "電話のベル",
    Helicopter: "ヘリコプター",
    Applause: "拍手",
    Gunshot: "銃声"
  }
});
;// CONCATENATED MODULE: ./src/common/localize/localizedString.ts

function localized(key, defaultValue) {
  // ja-JP or ja -> ja
  const locale = navigator.language.split("-")[0];

  if (key !== null && localization[locale] !== undefined && localization[locale][key] !== undefined) {
    return localization[locale][key];
  }

  return defaultValue;
}
;// CONCATENATED MODULE: ./src/landing/index.ts


const localize = () => {
  document.querySelectorAll("*[data-i18n]").forEach(e => {
    const key = e.getAttribute("data-i18n");

    if (key !== null) {
      const text = localized(key);

      if (text !== undefined) {
        e.textContent = text;
      }
    }
  });
};

window.addEventListener("DOMContentLoaded", e => {
  console.log("DOM fully loaded and parsed");
  localize();
});
})();

/******/ })()
;
//# sourceMappingURL=browserLanding-032420b681864c3d4ef2.js.map