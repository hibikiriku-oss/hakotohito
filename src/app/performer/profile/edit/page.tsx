"use client";

import { requireLineIdToken } from "@/lib/require-line-id-token";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import liff from "@line/liff";

type StatusLevel = "beginner" | "amateur" | "pro" | "";

type AreaInput = {
  prefecture: string;
  municipality: string;
};

type ReviewSummary = {
  average_rating: number;
  review_count: number;
};

const prefectures = [
  "北海道",
  "青森県", "岩手県", "宮城県", "秋田県", "山形県", "福島県",
  "茨城県", "栃木県", "群馬県", "埼玉県", "千葉県", "東京都", "神奈川県",
  "新潟県", "富山県", "石川県", "福井県", "山梨県", "長野県",
  "岐阜県", "静岡県", "愛知県", "三重県",
  "滋賀県", "京都府", "大阪府", "兵庫県", "奈良県", "和歌山県",
  "鳥取県", "島根県", "岡山県", "広島県", "山口県",
  "徳島県", "香川県", "愛媛県", "高知県",
  "福岡県", "佐賀県", "長崎県", "熊本県", "大分県", "宮崎県",
  "鹿児島県", "沖縄県",
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

const statusLevelOptions: {
  value: Exclude<StatusLevel, "">;
  label: string;
  shortLabel: string;
  description: string;
  colorClass: string;
  borderClass: string;
  textClass: string;
}[] = [
  {
    value: "beginner",
    label: "初心者",
    shortLabel: "BEGINNER",
    description: "人前での演奏経験がほぼ0",
    colorClass: "bg-green-50",
    borderClass: "border-green-200",
    textClass: "text-green-700",
  },
  {
    value: "amateur",
    label: "アマチュア",
    shortLabel: "AMATEUR",
    description:
      "人前での演奏は度々こなしているが、有料チケットを購入してもらえるほどの腕前ではない",
    colorClass: "bg-blue-50",
    borderClass: "border-blue-200",
    textClass: "text-blue-700",
  },
  {
    value: "pro",
    label: "プロ",
    shortLabel: "PRO",
    description: "演奏料やレッスン代金を生活の糧にしている",
    colorClass: "bg-violet-200",
    borderClass: "border-violet-400",
    textClass: "text-violet-900",
  },
];

const inputClass =
  "w-full border border-gray-200 rounded-xl px-4 py-3 bg-gray-50 text-gray-900 outline-none focus:bg-white focus:ring-2 focus:ring-black";

const checkboxClass =
  "flex items-center gap-2 rounded-xl border p-3 text-sm cursor-pointer";

function splitValues(value: string): string[] {
  return value
    .split(/[,、，\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function parseArea(value: string): AreaInput {
  const prefecture = prefectures.find((item) =>
    value.startsWith(item)
  );

  if (prefecture) {
    return {
      prefecture,
      municipality: value.slice(prefecture.length).trim(),
    };
  }

  // 都道府県が含まれていない旧データも編集可能にする
  return {
    prefecture: "愛知県",
    municipality: value.trim(),
  };
}

function splitKnownAndCustom(
  values: unknown,
  options: string[]
): { selected: string[]; custom: string } {
  const list = Array.isArray(values)
    ? values.filter((item): item is string => typeof item === "string")
    : [];

  return {
    selected: list.filter((item) => options.includes(item)),
    custom: list.filter((item) => !options.includes(item)).join(", "),
  };
}

export default function PerformerProfileEditPage() {
  const router = useRouter();

  const [lineUserId, setLineUserId] = useState("");
  const [name, setName] = useState("");
  const [areas, setAreas] = useState<AreaInput[]>([
    { prefecture: "愛知県", municipality: "" },
  ]);

  const [instruments, setInstruments] = useState<string[]>([]);
  const [otherInstrument, setOtherInstrument] = useState("");
  const [genres, setGenres] = useState<string[]>([]);
  const [otherGenre, setOtherGenre] = useState("");

  const [bio, setBio] = useState("");
  const [statusLevel, setStatusLevel] = useState<StatusLevel>("");
  const [reviewSummary, setReviewSummary] =
    useState<ReviewSummary | null>(null);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

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

  const updateArea = (
    index: number,
    field: keyof AreaInput,
    value: string
  ) => {
    setAreas((current) =>
      current.map((area, i) =>
        i === index ? { ...area, [field]: value } : area
      )
    );
  };

  const loadProfile = async (userId: string) => {
    const response = await fetch("/api/performers/profile", {
      headers: { Authorization: `Bearer ${requireLineIdToken(liff.getIDToken())}`,},
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "プロフィールを取得できませんでした");
    }

    const performer = data.performer;

    setName(performer.name || "");

    const storedAreas =
      Array.isArray(performer.areas) && performer.areas.length > 0
        ? performer.areas
        : performer.area
          ? [performer.area]
          : [];

    setAreas(
      storedAreas.length > 0
        ? storedAreas.map((area: string) => parseArea(area))
        : [{ prefecture: "愛知県", municipality: "" }]
    );

    const instrumentData = splitKnownAndCustom(
      performer.instruments,
      instrumentOptions
    );
    setInstruments(instrumentData.selected);
    setOtherInstrument(instrumentData.custom);

    const genreData = splitKnownAndCustom(
      performer.genres,
      genreOptions
    );
    setGenres(genreData.selected);
    setOtherGenre(genreData.custom);

    setBio(performer.bio || "");

    setStatusLevel(
      ["beginner", "amateur", "pro"].includes(performer.status_level)
        ? performer.status_level
        : ""
    );

    // 評価は件数と平均点だけ取得。個別コメントは詳細画面で表示する。
    try {
      const reviewResponse = await fetch(
        `/api/performers/${performer.id}/reviews`
      );
      if (reviewResponse.ok) {
        const reviewData = await reviewResponse.json();
        setReviewSummary({
          average_rating: Number(reviewData.average_rating) || 0,
          review_count: Number(reviewData.review_count) || 0,
        });
      }
    } catch (reviewError) {
      console.error("評価概要取得エラー:", reviewError);
    }
  };

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
        await loadProfile(profile.userId);
      } catch (err) {
        console.error("プロフィール初期化エラー:", err);
        setError(
          err instanceof Error
            ? err.message
            : "プロフィールの取得に失敗しました"
        );
      } finally {
        setLoading(false);
      }
    }

    initLiff();
  }, []);

  const handleSubmit = async (
    event: React.FormEvent<HTMLFormElement>
  ) => {
    event.preventDefault();

    const finalAreas = unique(
      areas
        .map((area) =>
          `${area.prefecture}${area.municipality.trim()}`
        )
        .filter((area) => {
          const municipality = area.replace(
            new RegExp(`^(${prefectures.join("|")})`),
            ""
          );
          return municipality.trim().length > 0;
        })
    );

    const finalInstruments = unique([
      ...instruments,
      ...splitValues(otherInstrument),
    ]);

    const finalGenres = unique([
      ...genres,
      ...splitValues(otherGenre),
    ]);

    if (
      !name.trim() ||
      finalAreas.length === 0 ||
      finalInstruments.length === 0 ||
      finalGenres.length === 0 ||
      !statusLevel
    ) {
      alert(
        "名前・活動エリア・楽器・音楽ジャンル・演奏レベルを入力してください"
      );
      return;
    }

    if (!lineUserId) {
      alert("LINE情報を取得中です。少し待ってからお試しください。");
      return;
    }

    try {
      setSaving(true);
      setError("");

      const response = await fetch("/api/performers/profile", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${requireLineIdToken(liff.getIDToken())}`,
        },
        body: JSON.stringify({
          name: name.trim(),
          area: finalAreas[0],
          areas: finalAreas,
          instruments: finalInstruments,
          genres: finalGenres,
          bio,
          statusLevel,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "プロフィールの更新に失敗しました");
      }

      alert("プロフィールを更新しました");
      router.push("/performer/home");
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "プロフィールの更新に失敗しました";
      setError(message);
      alert(message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <main className="min-h-screen bg-gray-50 p-8 text-center">
        プロフィールを読み込んでいます...
      </main>
    );
  }

  if (error && !name) {
    return (
      <main className="min-h-screen bg-gray-50 p-6">
        <button onClick={() => router.push("/performer/home")}>
          ← ホームへ戻る
        </button>
        <p className="mt-6 text-red-600">{error}</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="max-w-md mx-auto px-4 py-6 pb-10">
        <button
          type="button"
          onClick={() => router.push("/performer/home")}
          className="text-sm text-gray-500"
        >
          ← ホームへ戻る
        </button>

        <header className="mt-6 mb-6">
          <p className="text-sm font-bold text-gray-500">🎸 演奏者ホーム</p>
          <h1 className="text-2xl font-bold mt-1">プロフィール編集</h1>
          <p className="text-sm text-gray-500 mt-2">
            施設に表示されるプロフィールを編集できます。
          </p>
        </header>

        <form onSubmit={handleSubmit} className="space-y-5">
          {/* 名前 */}
          <section className="bg-white border border-gray-200 rounded-2xl p-5">
            <label className="font-bold text-sm block mb-2">
              名前 <span className="text-red-500">＊必須</span>
            </label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例：山田太郎"
              className={inputClass}
              required
            />
          </section>

          {/* 活動エリア */}
          <section className="bg-white border border-gray-200 rounded-2xl p-5">
            <h2 className="font-bold mb-2">
              活動エリア <span className="text-red-500">＊必須</span>
            </h2>
            <p className="text-xs text-gray-500 mb-4">
              都道府県を選び、市区町村を入力してください。複数登録できます。
            </p>

            <div className="space-y-4">
              {areas.map((area, index) => (
                <div
                  key={index}
                  className="rounded-xl border border-gray-200 p-3"
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-bold">
                      活動エリア {index + 1}
                    </span>
                    {areas.length > 1 && (
                      <button
                        type="button"
                        onClick={() =>
                          setAreas((current) =>
                            current.filter((_, i) => i !== index)
                          )
                        }
                        className="text-xs text-red-600"
                      >
                        削除
                      </button>
                    )}
                  </div>

                  <select
                    value={area.prefecture}
                    onChange={(e) =>
                      updateArea(index, "prefecture", e.target.value)
                    }
                    className={inputClass}
                  >
                    {prefectures.map((prefecture) => (
                      <option key={prefecture} value={prefecture}>
                        {prefecture}
                      </option>
                    ))}
                  </select>

                  <input
                    value={area.municipality}
                    onChange={(e) =>
                      updateArea(index, "municipality", e.target.value)
                    }
                    placeholder="例：名古屋市千種区、豊田市"
                    className={`${inputClass} mt-3`}
                  />

                  {area.municipality.trim() && (
                    <p className="text-xs text-gray-500 mt-2">
                      登録地域：{area.prefecture}{area.municipality.trim()}
                    </p>
                  )}
                </div>
              ))}
            </div>

            <button
              type="button"
              onClick={() =>
                setAreas((current) => [
                  ...current,
                  { prefecture: "愛知県", municipality: "" },
                ])
              }
              className="w-full mt-3 rounded-xl border border-dashed border-gray-400 p-3 text-sm font-bold"
            >
              ＋ 活動エリアを追加
            </button>
          </section>

          {/* 楽器 */}
          <section className="bg-white border border-gray-200 rounded-2xl p-5">
            <h2 className="font-bold mb-3">
              楽器 <span className="text-red-500">＊必須</span>
            </h2>
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

            <label className="block text-sm font-bold mt-4 mb-2">
              その他の楽器
            </label>
            <input
              value={otherInstrument}
              onChange={(e) => setOtherInstrument(e.target.value)}
              placeholder="例：二胡、バンドネオン"
              className={inputClass}
            />
            <p className="text-xs text-gray-400 mt-2">
              複数ある場合は「,」または「、」で区切ってください。
            </p>
          </section>

          {/* ジャンル */}
          <section className="bg-white border border-gray-200 rounded-2xl p-5">
            <h2 className="font-bold mb-3">
              音楽ジャンル <span className="text-red-500">＊必須</span>
            </h2>
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

            <label className="block text-sm font-bold mt-4 mb-2">
              その他のジャンル
            </label>
            <input
              value={otherGenre}
              onChange={(e) => setOtherGenre(e.target.value)}
              placeholder="例：ボサノバ、タンゴ"
              className={inputClass}
            />
            <p className="text-xs text-gray-400 mt-2">
              複数ある場合は「,」または「、」で区切ってください。
            </p>
          </section>

          {/* 演奏レベル */}
          <section className="bg-white border border-gray-200 rounded-2xl p-5">
            <h2 className="font-bold mb-2">
              演奏レベル <span className="text-red-500">＊必須</span>
            </h2>
            <p className="text-xs text-gray-500 leading-5 mb-4">
              ご自身の判断で近いものを選択してください。このレベルは自己申告であり、運営による認定ではありません。
            </p>

            <div className="space-y-3">
              {statusLevelOptions.map((option) => {
                const selected = statusLevel === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setStatusLevel(option.value)}
                    disabled={saving}
                    className={`w-full text-left rounded-2xl border p-4 ${
                      selected
                        ? "border-black ring-2 ring-black/10"
                        : "border-gray-200"
                    } bg-white disabled:opacity-50`}
                  >
                    <div className="flex items-center gap-4">
                      <div
                        className={`shrink-0 w-[86px] h-[64px] flex flex-col items-center justify-center border-2 shadow-sm ${option.colorClass} ${option.borderClass} ${option.textClass}`}
                        style={{
                          clipPath:
                            "polygon(8% 0%, 92% 0%, 100% 12%, 100% 82%, 82% 82%, 50% 100%, 18% 82%, 0% 82%, 0% 12%)",
                        }}
                      >
                        <span className="text-[10px] font-black">
                          {option.shortLabel}
                        </span>
                        <span className="text-sm font-black mt-1">
                          {option.label}
                        </span>
                      </div>
                      <div className="flex-1">
                        <p className="font-bold">{option.label}</p>
                        <p className="text-xs text-gray-500 leading-5 mt-1">
                          {option.description}
                        </p>
                        {selected && (
                          <span className="inline-block mt-2 text-[10px] bg-black text-white px-2 py-1 rounded-full">
                            選択中
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </section>

          {/* 自己紹介 */}
          <section className="bg-white border border-gray-200 rounded-2xl p-5">
            <label className="font-bold block mb-2">自己紹介</label>
            <textarea
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              placeholder="演奏経験や活動内容など"
              rows={6}
              className={`${inputClass} resize-none`}
            />
          </section>

          {/* 評価：画面下部に件数と平均だけ表示 */}
          <section className="bg-white border border-gray-200 rounded-2xl p-5">
            <button
              type="button"
              onClick={() => router.push("/performer/profile/reviews")}
              className="w-full text-left"
            >
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-bold text-gray-400">
                    REVIEWS
                  </p>
                  <h2 className="font-bold mt-1">⭐ 受け取った評価</h2>
                  <p className="text-sm text-gray-500 mt-2">
                    個別の評価・コメントを確認する
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-2xl font-bold">
                    {reviewSummary && reviewSummary.review_count > 0
                      ? reviewSummary.average_rating.toFixed(1)
                      : "—"}
                  </p>
                  <p className="text-xs text-gray-500">平均評価</p>
                  <p className="text-xs text-gray-500 mt-1">
                    {reviewSummary?.review_count ?? 0}件
                  </p>
                </div>
                <span className="text-gray-400">›</span>
              </div>
            </button>
          </section>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-2xl p-4">
              <p className="text-sm text-red-600">{error}</p>
            </div>
          )}

          <button
            type="submit"
            disabled={saving}
            className="w-full bg-black text-white rounded-2xl p-4 font-bold disabled:opacity-50"
          >
            {saving ? "更新しています..." : "プロフィールを更新する"}
          </button>

          <button
            type="button"
            onClick={() => router.push("/performer/home")}
            disabled={saving}
            className="w-full border border-gray-200 text-gray-600 rounded-2xl p-4 font-bold bg-white disabled:opacity-50"
          >
            キャンセル
          </button>
        </form>
      </div>
    </main>
  );
}
