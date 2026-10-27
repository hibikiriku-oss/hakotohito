"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useParams, useRouter } from "next/navigation";
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
  "ピアノ", "ギター", "ウクレレ", "バイオリン", "ビオラ", "チェロ",
  "コントラバス", "フルート", "クラリネット", "サックス",
  "トランペット", "トロンボーン", "リコーダー", "ハーモニカ",
  "オカリナ", "箏", "尺八", "和太鼓", "打楽器", "声楽・歌",
];

const genreOptions = [
  "クラシック", "ポップス", "ジャズ", "演歌・歌謡曲", "童謡・唱歌",
  "アニメ・ゲーム音楽", "映画音楽", "民謡", "邦楽", "ロック",
  "フォーク", "ゴスペル",
];

const targetLevelOptions = ["初心者", "アマ", "プロ"];

type LessonOffer = {
  id: string;
  performer_id: string;
  title: string;
  description: string | null;
  instruments: string[] | null;
  genres: string[] | null;
  area: string | null;
  lesson_date: string | null;
  start_time: string | null;
  end_time: string | null;
  lesson_fee: number;
  capacity: number;
  target_levels: string[] | null;
  status: string;
  is_mine: boolean;
};

function parseCustomValues(value: string): string[] {
  return Array.from(
    new Set(
      value
        .split(/[,、，]/)
        .map((item) => item.trim())
        .filter(Boolean)
    )
  );
}

function normalizeTime(value: string | null): string {
  return value ? value.slice(0, 5) : "";
}

function splitArea(area: string | null): {
  prefecture: string;
  municipality: string;
} {
  if (!area) {
    return { prefecture: "愛知県", municipality: "" };
  }

  const found = prefectures.find((item) => area.startsWith(item));

  if (!found) {
    return { prefecture: "愛知県", municipality: area };
  }

  return {
    prefecture: found,
    municipality: area.slice(found.length),
  };
}

export default function EditLessonOfferPage() {
  const params = useParams();
  const router = useRouter();
  const offerId = String(params.id);

  const [lineUserId, setLineUserId] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [prefecture, setPrefecture] = useState("愛知県");
  const [municipality, setMunicipality] = useState("");

  const [instruments, setInstruments] = useState<string[]>([]);
  const [customInstruments, setCustomInstruments] = useState("");
  const [genres, setGenres] = useState<string[]>([]);
  const [customGenres, setCustomGenres] = useState("");
  const [targetLevels, setTargetLevels] = useState<string[]>([
    "初心者", "アマ", "プロ",
  ]);

  const [lessonDate, setLessonDate] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [lessonFee, setLessonFee] = useState("0");
  const [capacity, setCapacity] = useState("5");
  const [coinRates, setCoinRates] = useState({
    free_lesson_match_fee_coins: 5,
    paid_lesson_fee_percent: 1,
  });

  useEffect(() => {
    let cancelled = false;

    async function loadCoinRates() {
      try {
        const response = await fetch("/api/coin-rates", {
          cache: "no-store",
        });

        if (!response.ok) {
          throw new Error("料金設定を取得できませんでした");
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

const loadOffer = useCallback(
  async () => {
    const idToken = liff.getIDToken();

    if (!idToken) {
      throw new Error(
        "LINEの本人確認情報を取得できません。再ログインしてください。"
      );
    }

    const response = await fetch(`/api/lesson-offers/${offerId}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${idToken}`,
      },
      cache: "no-store",
    });

      const data = await response.json();

      if (!response.ok || !data.success || !data.offer) {
        throw new Error(data.error || "募集内容を取得できませんでした");
      }

      const offer = data.offer as LessonOffer;

      if (!offer.is_mine) {
        throw new Error("この募集を編集する権限がありません");
      }

      if (offer.status !== "open") {
        throw new Error("募集中のレッスンのみ編集できます");
      }

      const areaParts = splitArea(offer.area);

      setTitle(offer.title || "");
      setDescription(offer.description || "");
      setPrefecture(areaParts.prefecture);
      setMunicipality(areaParts.municipality);

      setInstruments(offer.instruments || []);
      setGenres(offer.genres || []);
      setTargetLevels(
        (offer.target_levels || []).filter((level) =>
          targetLevelOptions.includes(level)
        )
      );

      setLessonDate(offer.lesson_date || "");
      setStartTime(normalizeTime(offer.start_time));
      setEndTime(normalizeTime(offer.end_time));
      setLessonFee(String(offer.lesson_fee ?? 0));
      setCapacity(String(offer.capacity ?? 5));
    },
    [offerId]
  );

  useEffect(() => {
    let cancelled = false;

    async function initialize() {
      try {
        await liff.init({
          liffId: process.env.NEXT_PUBLIC_LIFF_ID!,
          withLoginOnExternalBrowser: true,
        });

        if (!liff.isLoggedIn()) {
          liff.login();
          return;
        }

const profile = await liff.getProfile();

if (cancelled) return;

setLineUserId(profile.userId);
await loadOffer();

        if (!cancelled) setLoaded(true);
      } catch (error) {
        if (!cancelled) {
          setErrorMessage(
            error instanceof Error
              ? error.message
              : "初期化に失敗しました"
          );
        }
      }
    }

    initialize();

    return () => {
      cancelled = true;
    };
  }, [loadOffer]);

  function toggleValue(
    value: string,
    current: string[],
    setter: (values: string[]) => void
  ) {
    setter(
      current.includes(value)
        ? current.filter((item) => item !== value)
        : [...current, value]
    );
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage("");

    if (!lineUserId) {
      setErrorMessage("LINEのログイン情報を取得できません。");
      return;
    }

    if (!title.trim()) {
      setErrorMessage("募集タイトルを入力してください。");
      return;
    }

    if (targetLevels.length === 0) {
      setErrorMessage("対象ランクを1つ以上選択してください。");
      return;
    }

    if (
      (lessonDate || startTime || endTime) &&
      !(lessonDate && startTime && endTime)
    ) {
      setErrorMessage(
        "日時を設定する場合は、日付・開始時間・終了時間をすべて入力してください。"
      );
      return;
    }

    if (startTime && endTime && endTime <= startTime) {
      setErrorMessage("終了時間は開始時間より後にしてください。");
      return;
    }

    const fee = Number(lessonFee);
    const seats = Number(capacity);

    if (!/^\d+$/.test(lessonFee) || !Number.isSafeInteger(fee) || fee < 0) {
      setErrorMessage("料金は0以上の整数で入力してください。");
      return;
    }

    if (
      !/^\d+$/.test(capacity) ||
      !Number.isSafeInteger(seats) ||
      seats < 1 ||
      seats > 100
    ) {
      setErrorMessage("定員は1〜100人で入力してください。");
      return;
    }

    const finalInstruments = Array.from(
      new Set([...instruments, ...parseCustomValues(customInstruments)])
    );

    const finalGenres = Array.from(
      new Set([...genres, ...parseCustomValues(customGenres)])
    );

    setLoading(true);

    try {
const idToken = liff.getIDToken();

if (!idToken) {
  setErrorMessage(
    "LINEの本人確認情報を取得できません。再ログインしてください。"
  );
  return;
}

const response = await fetch(`/api/lesson-offers/${offerId}`, {
  method: "PUT",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${idToken}`,
  },
        body: JSON.stringify({
          title: title.trim(),
          description,
          instruments: finalInstruments,
          genres: finalGenres,
          targetLevels,
          area: municipality.trim()
            ? `${prefecture}${municipality.trim()}`
            : prefecture,
          lessonDate: lessonDate || null,
          startTime: startTime || null,
          endTime: endTime || null,
          lessonFee: fee,
          capacity: seats,
        }),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || "募集内容を保存できませんでした");
      }

      alert(
        `募集内容を更新しました。\n仮押さえコイン：${data.reserved_coins ?? 0}枚`
      );

      router.push(`/performer/lesson/${offerId}`);
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "保存中にエラーが発生しました"
      );
    } finally {
      setLoading(false);
    }
  }

  if (errorMessage && !loaded) {
    return (
      <main style={{ padding: 20, maxWidth: 640, margin: "0 auto" }}>
        <h1>レッスン募集の編集</h1>
        <p style={{ color: "#c62828" }}>{errorMessage}</p>
        <button type="button" onClick={() => router.back()}>
          戻る
        </button>
      </main>
    );
  }

  if (!loaded) {
    return (
      <main style={{ padding: 20, textAlign: "center" }}>
        読み込み中…
      </main>
    );
  }

  const inputStyle = {
    width: "100%",
    padding: 10,
    marginTop: 6,
    boxSizing: "border-box" as const,
    border: "1px solid #ccc",
    borderRadius: 8,
    fontSize: 16,
  };

  const sectionStyle = {
    marginBottom: 20,
    padding: 16,
    border: "1px solid #e0e0e0",
    borderRadius: 12,
  };

  return (
    <main
      style={{
        padding: 16,
        maxWidth: 640,
        margin: "0 auto",
        color: "#222",
      }}
    >
      <button
        type="button"
        onClick={() => router.push(`/performer/lesson/${offerId}`)}
        style={{ marginBottom: 16 }}
      >
        ← 募集詳細に戻る
      </button>

      <h1 style={{ fontSize: 24, marginBottom: 8 }}>
        ✏️ レッスン募集の編集
      </h1>
      <p style={{ color: "#666", marginBottom: 20 }}>
        内容を修正して「変更を保存」を押してください。
      </p>

      <form onSubmit={handleSubmit}>
        <section style={sectionStyle}>
          <h2>募集内容</h2>

          <label>
            募集タイトル *
            <input
              style={inputStyle}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={120}
              required
            />
          </label>

          <label style={{ display: "block", marginTop: 16 }}>
            募集説明
            <textarea
              style={{ ...inputStyle, minHeight: 110 }}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              placeholder="レッスン内容や伝えたいことを入力してください"
            />
          </label>
        </section>

        <section style={sectionStyle}>
          <h2>楽器・ジャンル</h2>

          <p>対象の楽器（複数選択可）</p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {instrumentOptions.map((item) => (
              <label
                key={item}
                style={{
                  padding: "7px 10px",
                  border: "1px solid #ccc",
                  borderRadius: 8,
                }}
              >
                <input
                  type="checkbox"
                  checked={instruments.includes(item)}
                  onChange={() =>
                    toggleValue(item, instruments, setInstruments)
                  }
                />{" "}
                {item}
              </label>
            ))}
          </div>

          <label style={{ display: "block", marginTop: 12 }}>
            その他の楽器（カンマ区切りで複数入力可）
            <input
              style={inputStyle}
              value={customInstruments}
              onChange={(e) => setCustomInstruments(e.target.value)}
              placeholder="例：マンドリン、二胡"
            />
          </label>

          <p style={{ marginTop: 20 }}>ジャンル（複数選択可）</p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {genreOptions.map((item) => (
              <label
                key={item}
                style={{
                  padding: "7px 10px",
                  border: "1px solid #ccc",
                  borderRadius: 8,
                }}
              >
                <input
                  type="checkbox"
                  checked={genres.includes(item)}
                  onChange={() => toggleValue(item, genres, setGenres)}
                />{" "}
                {item}
              </label>
            ))}
          </div>

          <label style={{ display: "block", marginTop: 12 }}>
            その他のジャンル（カンマ区切りで複数入力可）
            <input
              style={inputStyle}
              value={customGenres}
              onChange={(e) => setCustomGenres(e.target.value)}
              placeholder="例：ボサノバ、タンゴ"
            />
          </label>
        </section>

        <section style={sectionStyle}>
          <h2>対象ランク</h2>
          <p>参加してほしい演奏者のランクを選択してください。</p>

          <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
            {targetLevelOptions.map((item) => (
              <label key={item}>
                <input
                  type="checkbox"
                  checked={targetLevels.includes(item)}
                  onChange={() =>
                    toggleValue(item, targetLevels, setTargetLevels)
                  }
                />{" "}
                {item}
              </label>
            ))}
          </div>
        </section>

        <section style={sectionStyle}>
          <h2>開催エリア</h2>

          <label>
            都道府県
            <select
              style={inputStyle}
              value={prefecture}
              onChange={(e) => setPrefecture(e.target.value)}
            >
              {prefectures.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>

          <label style={{ display: "block", marginTop: 12 }}>
            市区町村・その他
            <input
              style={inputStyle}
              value={municipality}
              onChange={(e) => setMunicipality(e.target.value)}
              placeholder="例：名古屋市中区"
            />
          </label>
        </section>

        <section style={sectionStyle}>
          <h2>開催日時</h2>
          <p style={{ color: "#666" }}>
            日時をまだ決めていない場合は、3項目とも空欄にしてください。
          </p>

          <label>
            開催日
            <input
              style={inputStyle}
              type="date"
              value={lessonDate}
              onChange={(e) => setLessonDate(e.target.value)}
            />
          </label>

          <label style={{ display: "block", marginTop: 12 }}>
            開始時間
            <input
              style={inputStyle}
              type="time"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
            />
          </label>

          <label style={{ display: "block", marginTop: 12 }}>
            終了時間
            <input
              style={inputStyle}
              type="time"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
            />
          </label>
        </section>

        <section style={sectionStyle}>
          <h2>料金・定員</h2>

          <label>
            1人あたりのレッスン料金（円）
            <input
              style={inputStyle}
              type="number"
              min="0"
              step="1"
              value={lessonFee}
              onChange={(e) => setLessonFee(e.target.value)}
              required
            />
          </label>

          <label style={{ display: "block", marginTop: 16 }}>
            定員（1〜100人）
            <input
              style={inputStyle}
              type="number"
              min="1"
              max="100"
              step="1"
              value={capacity}
              onChange={(e) => setCapacity(e.target.value)}
              required
            />
          </label>

          {Number.isSafeInteger(Number(lessonFee)) &&
            Number(lessonFee) >= 0 &&
            Number.isSafeInteger(Number(capacity)) &&
            Number(capacity) >= 1 &&
            Number(capacity) <= 100 && (
              <p style={{ marginTop: 12, color: "#555" }}>
                参考：1人あたりの成立手数料は
                {Number(lessonFee) === 0
                  ? String(coinRates.free_lesson_match_fee_coins)
                  : String(
                      Math.ceil(
                        (Number(lessonFee) * coinRates.paid_lesson_fee_percent) / 100
                      )
                    )}                枚です。変更後の仮押さえ額は保存時に再計算されます。
              </p>
            )}
        </section>

        {errorMessage && (
          <p
            role="alert"
            style={{
              color: "#c62828",
              background: "#fff0f0",
              padding: 12,
              borderRadius: 8,
            }}
          >
            {errorMessage}
          </p>
        )}

        <button
          type="submit"
          disabled={loading}
          style={{
            width: "100%",
            padding: 14,
            border: "none",
            borderRadius: 10,
            background: loading ? "#999" : "#1769aa",
            color: "white",
            fontSize: 17,
            fontWeight: "bold",
            cursor: loading ? "wait" : "pointer",
          }}
        >
          {loading ? "保存中…" : "変更を保存"}
        </button>

        <button
          type="button"
          onClick={() => router.push(`/performer/lesson/${offerId}`)}
          disabled={loading}
          style={{
            width: "100%",
            padding: 12,
            marginTop: 10,
            border: "1px solid #ccc",
            borderRadius: 10,
            background: "white",
            fontSize: 16,
          }}
        >
          キャンセル
        </button>
      </form>
    </main>
  );
}