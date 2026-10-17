"use client";

import { useEffect, useState } from "react";
import liff from "@line/liff";

const prefectures = [
  "北海道",
  "青森県", "岩手県", "宮城県", "秋田県", "山形県", "福島県",
  "茨城県", "栃木県", "群馬県", "埼玉県", "千葉県", "東京都", "神奈川県",
  "新潟県", "富山県", "石川県", "福井県", "山梨県", "長野県",
  "岐阜県", "静岡県", "愛知県", "三重県",
  "滋賀県", "京都府", "大阪府", "兵庫県", "奈良県", "和歌山県",
  "鳥取県", "島根県", "岡山県", "広島県", "山口県",
  "徳島県", "香川県", "愛媛県", "高知県",
  "福岡県", "佐賀県", "長崎県", "熊本県", "大分県", "宮崎県", "鹿児島県",
  "沖縄県",
];

const instrumentOptions = [
  "ピアノ", "ギター", "ウクレレ", "バイオリン", "ビオラ",
  "チェロ", "コントラバス", "フルート", "クラリネット",
  "サックス", "トランペット", "トロンボーン", "リコーダー",
  "ハーモニカ", "オカリナ", "箏", "尺八", "和太鼓",
  "打楽器", "声楽・歌",
];

const genreOptions = [
  "クラシック", "ポップス", "ジャズ", "演歌・歌謡曲",
  "童謡・唱歌", "アニメ・ゲーム音楽", "映画音楽",
  "民謡", "邦楽", "ロック", "フォーク", "ゴスペル",
];

const statusLevelOptions = [
  { value: "beginner", label: "初心者", description: "演奏を始めたばかりの方" },
  { value: "amateur", label: "アマチュア", description: "趣味や経験を活かして演奏する方" },
  { value: "pro", label: "プロ", description: "演奏を仕事として活動している方" },
];

const inputClass =
  "w-full border border-gray-200 rounded-xl px-4 py-3 bg-gray-50 text-gray-900 outline-none focus:bg-white focus:ring-2 focus:ring-black focus:border-transparent";

const checkboxClass =
  "flex items-center gap-2 rounded-xl border p-3 text-sm cursor-pointer";

// 日本時間（Asia/Tokyo）で今日の日付を YYYY-MM-DD 形式で取得
function getJapanToday(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());

  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;

  return `${year}-${month}-${day}`;
}

// YYYY-MM-DD の日付を1日進める／戻す
function shiftDate(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);
  const result = new Date(Date.UTC(year, month - 1, day + days));

  return [
    result.getUTCFullYear(),
    String(result.getUTCMonth() + 1).padStart(2, "0"),
    String(result.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

function parseCustomValues(value: string) {
  return value
    .split(/[,、]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export default function FacilityRequestPage() {
  const [lineUserId, setLineUserId] = useState("");

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [performanceDate, setPerformanceDate] = useState("");
  const [applicationDeadline, setApplicationDeadline] = useState(
    () => getJapanToday()
  );
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");

  const [prefecture, setPrefecture] = useState("愛知県");
  const [municipality, setMunicipality] = useState("");

  const [instruments, setInstruments] = useState<string[]>([]);
  const [otherInstrument, setOtherInstrument] = useState("");

  const [genres, setGenres] = useState<string[]>([]);
  const [otherGenre, setOtherGenre] = useState("");

  // 募集対象レベル。複数選択可能。
  const [targetLevels, setTargetLevels] = useState<string[]>([
    "beginner",
    "amateur",
    "pro",
  ]);

  const [requestType, setRequestType] = useState("performance");
  const [maxParticipants, setMaxParticipants] = useState("");
  const [participationFee, setParticipationFee] = useState("");
  const [rentalFee, setRentalFee] = useState("");

  const [reward, setReward] = useState("");
  const [loading, setLoading] = useState(false);
  
  const japanToday = getJapanToday();
  const minPerformanceDate = shiftDate(japanToday, 1);
  const maxApplicationDeadline = performanceDate
    ? shiftDate(performanceDate, -1)
    : undefined;

  useEffect(() => {
    async function initLiff() {
      try {
        const liffId = process.env.NEXT_PUBLIC_LIFF_ID;

        if (!liffId) {
          throw new Error("NEXT_PUBLIC_LIFF_IDが設定されていません");
        }

        await liff.init({
          liffId,
          withLoginOnExternalBrowser: true,
        });

        if (!liff.isLoggedIn()) {
          liff.login();
          return;
        }

        const profile = await liff.getProfile();
        setLineUserId(profile.userId);
      } catch (error) {
        console.error("LIFF ERROR:", error);
        alert("LINE情報の取得に失敗しました");
      }
    }

    initLiff();
  }, []);

  const toggleChoice = (
    value: string,
    selected: string[],
    setter: (values: string[]) => void
  ) => {
    setter(
      selected.includes(value)
        ? selected.filter((item) => item !== value)
        : [...selected, value]
    );
  };

  const handlePerformanceDateChange = (value: string) => {
    setPerformanceDate(value);

    // 応募期限が演奏日以降になった場合は、演奏日の前日に調整する。
    if (value && applicationDeadline >= value) {
      setApplicationDeadline(shiftDate(value, -1));
    }
  };

  const handleSubmit = async (
    e: React.FormEvent<HTMLFormElement>
  ) => {
    e.preventDefault();

    if (
      !title.trim() ||
      !performanceDate ||
      !applicationDeadline ||
      !startTime ||
      !endTime
    ) {
      alert("依頼タイトル・演奏日・応募期限・開始時間・終了時間を入力してください");
      return;
    }

    // 日本時間を基準に日付を検証する
    const today = getJapanToday();

    if (performanceDate <= today) {
      alert("演奏日は明日以降の日付を選択してください");
      return;
    }

    if (applicationDeadline < today) {
      alert("応募期限は今日以降の日付を選択してください");
      return;
    }

    if (applicationDeadline >= performanceDate) {
      alert("応募期限は演奏日の前日までに設定してください");
      return;
    }

    if (startTime >= endTime) {
      alert("終了時間は開始時間より後にしてください");
      return;
    }

    if (targetLevels.length === 0) {
      alert("募集する演奏者のレベルを1つ以上選択してください");
      return;
    }

    if (
      requestType !== "performance" &&
      (!maxParticipants ||
        !Number.isInteger(Number(maxParticipants)) ||
        Number(maxParticipants) < 1)
    ) {
      alert("最大参加人数を1人以上で入力してください");
      return;
    }

    if (
      participationFee !== "" &&
      (!Number.isInteger(Number(participationFee)) ||
        Number(participationFee) < 0)
    ) {
      alert("参加費は0円以上の整数で入力してください");
      return;
    }

    if (
      rentalFee !== "" &&
      (!Number.isInteger(Number(rentalFee)) ||
        Number(rentalFee) < 0)
    ) {
      alert("レンタル利用料金は0円以上の整数で入力してください");
      return;
    }

    if (
      reward !== "" &&
      (!Number.isInteger(Number(reward)) || Number(reward) < 0)
    ) {
      alert("謝礼は0円以上の整数で入力してください");
      return;
    }

    if (!lineUserId) {
      alert("LINEユーザー情報を取得中です。少し待ってから再度お試しください。");
      return;
    }

    const area = municipality.trim()
      ? `${prefecture}${municipality.trim()}`
      : "";

    const finalInstruments = [
      ...new Set([
        ...instruments,
        ...parseCustomValues(otherInstrument),
      ]),
    ];

    const finalGenres = [
      ...new Set([
        ...genres,
        ...parseCustomValues(otherGenre),
      ]),
    ];

    try {
      setLoading(true);

      const response = await fetch("/api/performance-requests", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-line-user-id": lineUserId,
        },
        body: JSON.stringify({
          title: title.trim(),
          description,
          performanceDate,
          applicationDeadline,
          startTime,
          endTime,
          area,
          instruments: finalInstruments,
          genres: finalGenres,
          reward,
          targetLevels,
          requestType,
          maxParticipants:
            requestType !== "performance" ? Number(maxParticipants) : null,
          participationFee:
            requestType === "live" ||
            requestType === "festival" ||
            requestType === "session"
              ? participationFee !== ""
                ? Number(participationFee)
                : null
              : null,
          rentalFee:
            requestType === "rental" && rentalFee !== ""
              ? Number(rentalFee)
              : null,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        alert(data.error || "登録に失敗しました");
        return;
      }

      alert("演奏依頼を登録しました！");
      window.location.href = "/facility/home";
    } catch (error) {
      console.error("登録エラー:", error);
      alert("通信エラーが発生しました");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="max-w-md mx-auto px-4 py-6">
        <header className="pb-6">
          <button
            type="button"
            onClick={() => window.history.back()}
            className="text-sm text-gray-500 mb-4"
          >
            ← 戻る
          </button>

          <p className="text-sm font-medium text-gray-500">案件管理</p>

          <h1 className="text-2xl font-bold text-gray-900 mt-1">
            🎵 演奏依頼を作成
          </h1>

          <p className="text-sm text-gray-500 mt-2 leading-relaxed">
            演奏してくれる方を募集するための依頼を登録してください。
          </p>
        </header>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* 基本情報 */}
          <section className="bg-white border border-gray-200 rounded-2xl p-5">
            <div className="mb-5">
              <h2 className="font-bold text-gray-900">基本情報</h2>
              <p className="text-xs text-gray-400 mt-1">
                演奏案件の基本的な情報を入力してください。
              </p>
            </div>

            <div>
              <label className="font-bold text-sm text-gray-800 mb-2 block">
                依頼タイトル <span className="text-red-500">＊必須</span>
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="例：施設でのピアノ演奏"
                className={inputClass}
                required
              />
            </div>

            <div className="mt-5">
              <label className="font-bold text-sm text-gray-800 mb-2 block">
                演奏日 <span className="text-red-500">＊必須</span>
              </label>
              <input
                type="date"
                value={performanceDate}
                min={minPerformanceDate}
                onChange={(e) => handlePerformanceDateChange(e.target.value)}
                className={inputClass}
                required
              />
              <p className="text-xs text-gray-500 mt-2">
                演奏日は明日以降の日付を選択してください。
              </p>
            </div>

            <div className="mt-5">
              <label className="font-bold text-sm text-gray-800 mb-2 block">
                応募期限 <span className="text-red-500">＊必須</span>
              </label>
              <input
                type="date"
                value={applicationDeadline}
                min={japanToday}
                max={maxApplicationDeadline}
                onChange={(e) => setApplicationDeadline(e.target.value)}
                className={inputClass}
                required
              />
              <p className="text-xs text-gray-500 mt-2 leading-relaxed">
                応募期限当日までは応募できます。期限の翌日になると募集一覧から非表示になります。
                応募期限は演奏日の前日まで設定できます。
              </p>
            </div>

            <div className="mt-5">
              <label className="font-bold text-sm text-gray-800 mb-2 block">
                演奏時間 <span className="text-red-500">＊必須</span>
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  className="flex-1 min-w-0 border border-gray-200 rounded-xl px-3 py-3 bg-gray-50"
                  required
                />
                <span className="text-gray-400">〜</span>
                <input
                  type="time"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  className="flex-1 min-w-0 border border-gray-200 rounded-xl px-3 py-3 bg-gray-50"
                  required
                />
              </div>
            </div>

            {/* 開催エリア */}
            <div className="mt-5">
              <label className="font-bold text-sm text-gray-800 mb-2 block">
                開催エリア（市区町村）
              </label>
              <p className="text-xs text-gray-500 mb-3">
                演奏者の活動地域と合わせるため、市区町村まで入力してください。
              </p>

              <select
                value={prefecture}
                onChange={(e) => setPrefecture(e.target.value)}
                className={inputClass}
              >
                {prefectures.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>

              <input
                type="text"
                value={municipality}
                onChange={(e) => setMunicipality(e.target.value)}
                placeholder="例：名古屋市千種区、豊田市"
                className={`${inputClass} mt-3`}
              />

              <p className="text-xs text-gray-400 mt-2">
                登録される地域：
                {municipality.trim()
                  ? `${prefecture}${municipality.trim()}`
                  : "市区町村を入力すると表示されます"}
              </p>
            </div>
          </section>

          {/* 募集する演奏者のレベル */}
          <section className="bg-white border border-gray-200 rounded-2xl p-5">
            <div className="mb-4">
              <h2 className="font-bold text-gray-900">
                募集する演奏者のレベル
                <span className="text-red-500 ml-1">＊必須</span>
              </h2>
              <p className="text-xs text-gray-500 mt-2 leading-relaxed">
                この依頼に応募できる演奏者のレベルを選択してください。
                複数選択できます。
              </p>
            </div>

            <div className="space-y-2">
              {statusLevelOptions.map((item) => (
                <label
                  key={item.value}
                  className={`flex items-start gap-3 rounded-xl border p-4 cursor-pointer transition ${
                    targetLevels.includes(item.value)
                      ? "border-black bg-gray-100"
                      : "border-gray-200 bg-white"
                  }`}
                >
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={targetLevels.includes(item.value)}
                    onChange={() =>
                      toggleChoice(
                        item.value,
                        targetLevels,
                        setTargetLevels
                      )
                    }
                  />
                  <span>
                    <span className="block text-sm font-bold text-gray-900">
                      {item.label}
                    </span>
                    <span className="block text-xs text-gray-500 mt-1">
                      {item.description}
                    </span>
                  </span>
                </label>
              ))}
            </div>

            <p className="text-xs text-gray-500 mt-3">
              選択中：
              {statusLevelOptions
                .filter((item) => targetLevels.includes(item.value))
                .map((item) => item.label)
                .join("・") || "未選択"}
            </p>
          </section>

          {/* 希望する演奏 */}
          <section className="bg-white border border-gray-200 rounded-2xl p-5">
            <div className="mb-5">
              <h2 className="font-bold text-gray-900">希望する演奏</h2>
              <p className="text-xs text-gray-400 mt-1">
                希望する楽器や音楽ジャンルを選択してください。複数選べます。
              </p>
            </div>

            <div>
              <h3 className="font-bold text-sm text-gray-800 mb-3">
                希望する楽器
              </h3>
              <div className="grid grid-cols-2 gap-2">
                {instrumentOptions.map((item) => (
                  <label
                    key={item}
                    className={`${checkboxClass} ${
                      instruments.includes(item)
                        ? "border-black bg-gray-100"
                        : "border-gray-200"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={instruments.includes(item)}
                      onChange={() =>
                        toggleChoice(item, instruments, setInstruments)
                      }
                    />
                    <span>{item}</span>
                  </label>
                ))}
              </div>

              <label className="block text-sm font-bold text-gray-800 mt-4 mb-2">
                その他の楽器（任意）
              </label>
              <input
                type="text"
                value={otherInstrument}
                onChange={(e) => setOtherInstrument(e.target.value)}
                placeholder="例：二胡、バンドネオン"
                className={inputClass}
              />
              <p className="text-xs text-gray-400 mt-2">
                複数ある場合は「,」または「、」で区切れます。
              </p>
            </div>

            <div className="mt-6 border-t border-gray-100 pt-5">
              <h3 className="font-bold text-sm text-gray-800 mb-3">
                希望する音楽ジャンル
              </h3>
              <div className="grid grid-cols-2 gap-2">
                {genreOptions.map((item) => (
                  <label
                    key={item}
                    className={`${checkboxClass} ${
                      genres.includes(item)
                        ? "border-black bg-gray-100"
                        : "border-gray-200"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={genres.includes(item)}
                      onChange={() => toggleChoice(item, genres, setGenres)}
                    />
                    <span>{item}</span>
                  </label>
                ))}
              </div>

              <label className="block text-sm font-bold text-gray-800 mt-4 mb-2">
                その他のジャンル（任意）
              </label>
              <input
                type="text"
                value={otherGenre}
                onChange={(e) => setOtherGenre(e.target.value)}
                placeholder="例：ボサノバ、タンゴ"
                className={inputClass}
              />
              <p className="text-xs text-gray-400 mt-2">
                複数ある場合は「,」または「、」で区切れます。
              </p>
            </div>
          </section>

          {/* 謝礼 */}
          <section className="bg-white border border-gray-200 rounded-2xl p-5">
            <div className="mb-5">
              <h2 className="font-bold text-gray-900">謝礼</h2>
              <p className="text-xs text-gray-400 mt-1">
                演奏に対する謝礼を設定できます。
              </p>
            </div>

            <div className="flex items-center gap-2">
              <input
                type="number"
                min="0"
                value={reward}
                onChange={(e) => setReward(e.target.value)}
                placeholder="例：5000"
                className={inputClass}
              />
              <span className="font-bold text-gray-600">円</span>
            </div>

            <p className="text-xs text-gray-400 mt-2">
              無償の場合は空欄でも登録できます。
            </p>
          </section>

          {/* 依頼内容 */}
          <section className="bg-white border border-gray-200 rounded-2xl p-5">
            <div className="mb-5">
              <h2 className="font-bold text-gray-900">依頼内容</h2>
              <p className="text-xs text-gray-400 mt-1">
                演奏してほしい内容やイベントについて記入してください。
              </p>
            </div>

            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="演奏してほしい内容、施設のイベント内容など"
              rows={6}
              className={`${inputClass} resize-none`}
            />
          </section>

          {/* 登録 */}
          <div className="pt-1 pb-6">
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-black text-white rounded-2xl p-4 font-bold shadow-sm active:scale-[0.99] transition disabled:bg-gray-300 disabled:text-gray-500"
            >
              {loading ? "登録中..." : "🎵 演奏依頼を登録する"}
            </button>

            <p className="text-center text-xs text-gray-400 mt-3 leading-relaxed">
              登録した依頼は「自分の依頼」から確認できます。
            </p>
          </div>
        </form>
      </div>
    </main>
  );
}