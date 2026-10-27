"use client";

import { useEffect, useState } from "react";
import liff from "@line/liff";

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

const targetLevelOptions = ["初心者", "アマ", "プロ"];

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

const inputClass =
  "w-full border border-gray-200 rounded-xl px-4 py-3 bg-gray-50 text-gray-900 outline-none focus:bg-white focus:ring-2 focus:ring-black focus:border-transparent";

const checkboxClass =
  "flex items-center gap-2 rounded-xl border p-3 text-sm cursor-pointer";

function parseCustomValues(value: string) {
  return value
    .split(/[,、]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export default function NewLessonOfferPage() {
  const [lineUserId, setLineUserId] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");

  const [prefecture, setPrefecture] = useState("愛知県");
  const [municipality, setMunicipality] = useState("");
  const [address, setAddress] = useState("");
  const [instruments, setInstruments] = useState<string[]>([]);
  const [otherInstrument, setOtherInstrument] = useState("");
  const [genres, setGenres] = useState<string[]>([]);
  const [otherGenre, setOtherGenre] = useState("");

  const [targetLevels, setTargetLevels] = useState<string[]>([
    "初心者",
    "アマ",
    "プロ",
  ]);

  const [lessonDate, setLessonDate] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");

  const [lessonFee, setLessonFee] = useState("0");
  const [capacity, setCapacity] = useState("5");
  const [loading, setLoading] = useState(false);

  // 仮押さえコインの見積もり
  const feeNumber = Number(lessonFee);
  const capacityNumber = Number(capacity);

  const validFee =
    lessonFee.trim() !== "" &&
    Number.isSafeInteger(feeNumber) &&
    feeNumber >= 0;

  const validCapacity =
    capacity.trim() !== "" &&
    Number.isInteger(capacityNumber) &&
    capacityNumber >= 1 &&
    capacityNumber <= 100;

  const [coinRates, setCoinRates] = useState({
    free_lesson_match_fee_coins: 5,
    paid_lesson_fee_percent: 1,
  });

  const coinsPerPerson =
    validFee
      ? feeNumber === 0
        ? coinRates.free_lesson_match_fee_coins
        : Math.ceil(
            (feeNumber * coinRates.paid_lesson_fee_percent) / 100
          )
      : 0;

  const estimatedReservedCoins =
    validFee && validCapacity
      ? coinsPerPerson * capacityNumber
      : null;

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
        console.error("レッスン登録LIFFエラー:", error);
        alert("LINE情報の取得に失敗しました。画面を開き直してください。");
      }
    }

    initLiff();
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadCoinRates() {
      try {
        const response = await fetch("/api/coin-rates", {
          cache: "no-store",
        });

        if (!response.ok) {
          throw new Error("料金設定の取得に失敗しました");
        }

        const data = (await response.json()) as {
          free_lesson_match_fee_coins?: number;
          paid_lesson_fee_percent?: number;
        };

        const freeLessonFee = Number(data.free_lesson_match_fee_coins);
        const paidLessonPercent = Number(data.paid_lesson_fee_percent);

        if (
          !Number.isSafeInteger(freeLessonFee) ||
          freeLessonFee < 0 ||
          !Number.isFinite(paidLessonPercent) ||
          paidLessonPercent < 0 ||
          paidLessonPercent > 100
        ) {
          throw new Error("料金設定の値が不正です");
        }

        if (!cancelled) {
          setCoinRates({
            free_lesson_match_fee_coins: freeLessonFee,
            paid_lesson_fee_percent: paidLessonPercent,
          });
        }
      } catch (error) {
        console.error("料金設定の読み込みに失敗しました:", error);
      }
    }

    void loadCoinRates();

    return () => {
      cancelled = true;
    };
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

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    if (!title.trim()) {
      alert("レッスンタイトルを入力してください");
      return;
    }

    if (targetLevels.length === 0) {
      alert("対象ランクを1つ以上選択してください");
      return;
    }

    if (
      (lessonDate || startTime || endTime) &&
      (!lessonDate || !startTime || !endTime)
    ) {
      alert(
        "日時を設定する場合は、日付・開始時間・終了時間をすべて入力してください"
      );
      return;
    }

    if (startTime && endTime && startTime >= endTime) {
      alert("終了時間は開始時間より後にしてください");
      return;
    }

    if (!validFee) {
      alert("レッスン料は0円以上の整数で入力してください");
      return;
    }

    if (!validCapacity) {
      alert("定員は1〜100人で入力してください");
      return;
    }

    const idToken = liff.getIDToken();

    if (!idToken) {
      alert(
        "LINEの本人確認情報を取得できません。再ログインしてください。"
      );
      return;
    }

    const area = municipality.trim()
      ? `${prefecture}${municipality.trim()}`
      : "";

    const finalInstruments = Array.from(
      new Set([...instruments, ...parseCustomValues(otherInstrument)])
    );

    const finalGenres = Array.from(
      new Set([...genres, ...parseCustomValues(otherGenre)])
    );

    try {
      setLoading(true);

      const response = await fetch("/api/lesson-offers", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim(),
          instruments: finalInstruments,
          genres: finalGenres,
          targetLevels,
          area,
          address: address.trim(),
          lessonDate: lessonDate || null,          startTime: startTime || null,
          endTime: endTime || null,
          lessonFee: feeNumber,
          capacity: capacityNumber,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        let message = data.error || "レッスン募集の登録に失敗しました";

        if (
          Number.isFinite(Number(data.required_coins)) &&
          Number.isFinite(Number(data.available_coins))
        ) {
          message +=
            `\n\n必要なコイン：${Number(data.required_coins).toLocaleString()}コイン` +
            `\n利用可能なコイン：${Number(data.available_coins).toLocaleString()}コイン`;

          if (Number(data.required_coins) > Number(data.available_coins)) {
            message +=
              "\n\nコインが不足しています。定員を減らすか、コインを追加してから再度お試しください。";
          }
        }

        alert(message);
        return;
      }

      const reservedCoins = Number(data.reserved_coins);

      alert(
        Number.isFinite(reservedCoins)
          ? `レッスン募集を登録しました！\n${reservedCoins.toLocaleString()}コインを仮押さえしました。`
          : "レッスン募集を登録しました！"
      );

      window.location.href = "/performer/lesson";
    } catch (error) {
      console.error("レッスン募集登録エラー:", error);
      alert("通信エラーが発生しました。もう一度お試しください。");
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
            onClick={() => {
              window.location.href = "/performer/lesson";
            }}
            className="text-sm text-gray-500 mb-4"
          >
            ← レッスン募集一覧に戻る
          </button>

          <p className="text-sm font-medium text-gray-500">レッスン管理</p>

          <h1 className="text-2xl font-bold text-gray-900 mt-1">
            🎹 レッスンを募集
          </h1>

          <p className="text-sm text-gray-500 mt-2 leading-relaxed">
            得意な楽器や音楽の知識を活かして、レッスンの受講者を募集しましょう。
          </p>
        </header>

        <form onSubmit={handleSubmit} className="space-y-4">
          <section className="bg-white border border-gray-200 rounded-2xl p-5 space-y-5">
            <div>
              <h2 className="font-bold text-gray-900 mb-2">募集内容</h2>
              <label className="font-bold text-sm text-gray-800 mb-2 block">
                レッスンタイトル <span className="text-red-500">＊必須</span>
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="例：初心者向けピアノレッスン"
                maxLength={120}
                className={inputClass}
                required
              />
            </div>

            <div>
              <label className="font-bold text-sm text-gray-800 mb-2 block">
                レッスン内容・説明
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="対象レベル、教えられる内容、レッスン方法など"
                rows={5}
                className={`${inputClass} resize-none`}
              />
            </div>

            <div>
              <h3 className="font-bold text-sm text-gray-800 mb-2">
                対象ランク <span className="text-red-500">＊必須</span>
              </h3>
              <p className="text-xs text-gray-500 mb-3">
                このレッスンを受講できる演奏者のランクを選択してください。複数選択できます。
              </p>

              <div className="grid grid-cols-3 gap-2">
                {targetLevelOptions.map((item) => (
                  <label
                    key={item}
                    className={`${checkboxClass} justify-center ${
                      targetLevels.includes(item)
                        ? "border-black bg-gray-100 font-bold"
                        : "border-gray-200"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={targetLevels.includes(item)}
                      onChange={() =>
                        toggleChoice(item, targetLevels, setTargetLevels)
                      }
                    />
                    <span>{item}</span>
                  </label>
                ))}
              </div>
            </div>

            <div>
              <label className="font-bold text-sm text-gray-800 mb-2 block">
                開催エリア
              </label>
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
                            <label className="font-bold text-sm text-gray-800 mt-4 mb-2 block">
                詳しい開催住所（任意）
              </label>
              <input
                type="text"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                maxLength={500}
                placeholder="例：○○市○○町1-2-3、○○音楽教室"
                className={inputClass}
              />
              <p className="text-xs text-gray-400 mt-2">
                オンラインレッスンの場合は、エリアを空欄にしても登録できます。
              </p>
            </div>
          </section>

          <section className="bg-white border border-gray-200 rounded-2xl p-5">
            <h2 className="font-bold text-gray-900 mb-2">レッスン日時</h2>
            <p className="text-xs text-gray-500 mb-4">
              日時が決まっている場合は入力してください。未定の場合は空欄で登録できます。
            </p>

            <label className="font-bold text-sm text-gray-800 mb-2 block">
              日付
            </label>
            <input
              type="date"
              value={lessonDate}
              onChange={(e) => setLessonDate(e.target.value)}
              className={inputClass}
            />

            <div className="mt-4">
              <label className="font-bold text-sm text-gray-800 mb-2 block">
                開始・終了時間
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  className="flex-1 min-w-0 border border-gray-200 rounded-xl px-3 py-3 bg-gray-50"
                />
                <span className="text-gray-400">〜</span>
                <input
                  type="time"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  className="flex-1 min-w-0 border border-gray-200 rounded-xl px-3 py-3 bg-gray-50"
                />
              </div>
            </div>
          </section>

          <section className="bg-white border border-gray-200 rounded-2xl p-5">
            <h2 className="font-bold text-gray-900 mb-4">教えられる楽器</h2>
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
              その他の楽器
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
          </section>

          <section className="bg-white border border-gray-200 rounded-2xl p-5">
            <h2 className="font-bold text-gray-900 mb-4">音楽ジャンル</h2>
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
                    onChange={() =>
                      toggleChoice(item, genres, setGenres)
                    }
                  />
                  <span>{item}</span>
                </label>
              ))}
            </div>

            <label className="block text-sm font-bold text-gray-800 mt-4 mb-2">
              その他のジャンル
            </label>
            <input
              type="text"
              value={otherGenre}
              onChange={(e) => setOtherGenre(e.target.value)}
              placeholder="例：ボサノバ、タンゴ"
              className={inputClass}
            />
          </section>

          <section className="bg-white border border-gray-200 rounded-2xl p-5">
            <h2 className="font-bold text-gray-900 mb-2">レッスン料金</h2>
            <p className="text-xs text-gray-500 mb-4">
              1回のレッスン料金です。無料の場合は0円にしてください。
            </p>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min="0"
                step="1"
                value={lessonFee}
                onChange={(e) => setLessonFee(e.target.value)}
                className={inputClass}
                required
              />
              <span className="font-bold text-gray-600">円</span>
            </div>
          </section>

          <section className="bg-white border border-gray-200 rounded-2xl p-5">
            <h2 className="font-bold text-gray-900 mb-2">募集定員</h2>
            <p className="text-xs text-gray-500 mb-4">
              この募集で受け入れる受講者の最大人数です。
            </p>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min="1"
                max="100"
                step="1"
                value={capacity}
                onChange={(e) => setCapacity(e.target.value)}
                className={inputClass}
                required
              />
              <span className="font-bold text-gray-600">人</span>
            </div>
          </section>

          <section className="bg-blue-50 border border-blue-100 rounded-2xl p-5">
            <h2 className="font-bold text-gray-900 mb-2">
              仮押さえされるコイン
            </h2>

            {estimatedReservedCoins === null ? (
              <p className="text-sm text-red-600">
                レッスン料は0円以上の整数、定員は1〜100人で入力してください。
              </p>
            ) : (
              <>
                <p className="text-3xl font-bold text-gray-900">
                  {estimatedReservedCoins.toLocaleString()}
                  <span className="text-base ml-1">コイン</span>
                </p>
                <p className="text-sm text-gray-600 mt-2">
                  1人あたり {coinsPerPerson.toLocaleString()} コイン × 定員{" "}
                  {capacityNumber} 人
                </p>
                <p className="text-xs text-gray-500 mt-3 leading-relaxed">
                  {feeNumber === 0
                    ? `無料レッスンは、成立1人あたり${coinRates.free_lesson_match_fee_coins}コインです。`
                    : `有料レッスンは、レッスン料の${coinRates.paid_lesson_fee_percent}%（1コイン未満切り上げ）が成立1人あたりの手数料です。`}
                  募集登録時に、定員分のコインが仮押さえされます。実際の仮押さえ額はサーバー側で確定します。
                </p>
              </>
            )}
          </section>

          <div className="pt-1 pb-6">
            <button
              type="submit"
              disabled={loading || !lineUserId}
              className="w-full bg-black text-white rounded-2xl p-4 font-bold shadow-sm active:scale-[0.99] transition disabled:bg-gray-300 disabled:text-gray-500"
            >
              {loading ? "登録中..." : "🎹 レッスン募集を登録する"}
            </button>
            <p className="text-center text-xs text-gray-400 mt-3 leading-relaxed">
              登録した募集はレッスン一覧から確認できます。
            </p>
          </div>
        </form>
      </div>
    </main>
  );
}