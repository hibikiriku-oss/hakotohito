"use client";

import { requireLineIdToken } from "@/lib/require-line-id-token";
import { useEffect, useState } from "react";
import liff from "@line/liff";

const instrumentOptions = [
  "ピアノ", "ギター", "ベース", "ドラム", "ヴォーカル",
  "サックス", "トランペット", "パーカッション", "DJ", "和楽器",
];

const genreOptions = [
  "クラシック", "ロック・ポップス", "ジャズ・フュージョン",
  "ラテン・ボサノバ", "ヒップホップ・ラップ", "R&B",
  "アカペラ", "DJ・エレクトロ", "ワールドミュージック",
  "演歌・歌謡曲",
];

const avatarEmojis = [
  "🎸", "🎹", "🎤", "🥁", "🎷",
  "🎺", "🎻", "🎼", "🎵", "🎶",
  "🌟", "😊", "🌸", "🐱", "🐶",
];

const inputClass =
  "w-full border border-gray-200 rounded-2xl px-4 py-3 bg-gray-50 text-gray-900 outline-none focus:bg-white focus:border-black";

export default function PerformerPage() {
  const [lineUserId, setLineUserId] = useState("");
  const [name, setName] = useState("");

  const [avatarType, setAvatarType] = useState<"line" | "emoji">("line");
  const [avatarEmoji, setAvatarEmoji] = useState("🎸");

  const [areas, setAreas] = useState<string[]>([]);
  const [areaInput, setAreaInput] = useState("");

  const [instruments, setInstruments] = useState<string[]>([]);
  const [otherInstrument, setOtherInstrument] = useState("");

  const [genres, setGenres] = useState<string[]>([]);
  const [otherGenre, setOtherGenre] = useState("");

  const [bio, setBio] = useState("");
  const [loading, setLoading] = useState(false);

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

  const addArea = () => {
    const area = areaInput.trim().replace(/\s+/g, " ");

    if (!area) {
      alert("活動エリアを入力してください。");
      return;
    }

    if (
      areas.some(
        (item) => item.toLocaleLowerCase() === area.toLocaleLowerCase()
      )
    ) {
      alert("この活動エリアはすでに追加されています。");
      return;
    }

    setAreas((current) => [...current, area]);
    setAreaInput("");
  };

  const handleSubmit = async (
    e: React.FormEvent<HTMLFormElement>
  ) => {
    e.preventDefault();

    const inputArea = areaInput.trim().replace(/\s+/g, " ");
    const finalAreas = [...areas];

    if (
      inputArea &&
      !finalAreas.some(
        (item) => item.toLocaleLowerCase() === inputArea.toLocaleLowerCase()
      )
    ) {
      finalAreas.push(inputArea);
    }

    const finalInstruments = [
      ...instruments,
      ...(otherInstrument.trim()
        ? otherInstrument.split(/[,、]/).map((item) => item.trim()).filter(Boolean)
        : []),
    ];

    const finalGenres = [
      ...genres,
      ...(otherGenre.trim()
        ? otherGenre.split(/[,、]/).map((item) => item.trim()).filter(Boolean)
        : []),
    ];

    const missingFields = {
      name: !name.trim(),
      areas: finalAreas.length === 0,
      instruments: finalInstruments.length === 0,
      genres: finalGenres.length === 0,
    };

    console.log("演奏者登録の入力チェック:", {
      name,
      areas,
      areaInput,
      finalAreas,
      instruments,
      otherInstrument,
      finalInstruments,
      genres,
      otherGenre,
      finalGenres,
      missingFields,
    });

    if (
      missingFields.name ||
      missingFields.areas ||
      missingFields.instruments ||
      missingFields.genres
    ) {
      alert(
        `入力不足の項目：${
          [
            missingFields.name && "名前",
            missingFields.areas && "活動エリア",
            missingFields.instruments && "楽器",
            missingFields.genres && "音楽ジャンル",
          ]
            .filter(Boolean)
            .join("・")
        }`
      );
      return;
    }

    if (!lineUserId) {
      alert("LINEユーザー情報を取得中です。少し待ってから再度お試しください。");
      return;
    }

    try {
      setLoading(true);

      const response = await fetch("/api/performers", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${requireLineIdToken(liff.getIDToken())}`,
        },
        body: JSON.stringify({
          name: name.trim(),
          areas: finalAreas,
          area: finalAreas[0],
          instruments: [...new Set(finalInstruments)],
          genres: [...new Set(finalGenres)],
          bio,
          avatarType,
          avatarEmoji: avatarType === "emoji" ? avatarEmoji : null,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        alert(data.error || "登録に失敗しました");
        return;
      }

      alert("プロフィールを登録しました！");
      window.location.href = "/performer/home";
    } catch (error) {
      console.error("登録エラー:", error);
      alert("通信エラーが発生しました");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="max-w-md mx-auto px-4 pt-6 pb-10">
        <div className="mb-6">
          <div className="w-14 h-14 rounded-2xl bg-black text-white flex items-center justify-center text-3xl mb-4">
            🎸
          </div>
          <p className="text-xs font-bold tracking-wider text-gray-400 mb-2">
            演奏者として登録
          </p>
          <h1 className="text-2xl font-bold text-gray-900">
            演奏者プロフィール
          </h1>
          <p className="text-sm text-gray-500 mt-2 leading-6">
            活動できる地域や得意な楽器を登録して、施設からオファーを受けやすくしましょう。
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="bg-white rounded-3xl border border-gray-100 shadow-sm overflow-hidden"
        >
          <div className="p-5 space-y-6">
            <section>
              <h2 className="font-bold text-gray-900 mb-4">👤 基本情報</h2>

              <label className="block text-sm font-bold text-gray-800 mb-2">
                名前 <span className="text-red-500">*</span>
              </label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="例：山田太郎"
                className={inputClass}
                required
              />

              <div className="mt-5">
                <label className="block text-sm font-bold text-gray-800 mb-3">
                  プロフィールアイコン
                </label>

                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setAvatarType("line")}
                    className={`rounded-xl border p-3 text-sm font-bold ${
                      avatarType === "line"
                        ? "border-black bg-gray-100"
                        : "border-gray-200"
                    }`}
                  >
                    LINEプロフィール画像
                  </button>
                  <button
                    type="button"
                    onClick={() => setAvatarType("emoji")}
                    className={`rounded-xl border p-3 text-sm font-bold ${
                      avatarType === "emoji"
                        ? "border-black bg-gray-100"
                        : "border-gray-200"
                    }`}
                  >
                    絵文字アイコン
                  </button>
                </div>

                {avatarType === "emoji" && (
                  <div className="mt-4">
                    <p className="text-xs text-gray-500 mb-3">
                      使用する絵文字を1つ選択してください。
                    </p>
                    <div className="grid grid-cols-5 gap-2">
                      {avatarEmojis.map((emoji) => (
                        <button
                          key={emoji}
                          type="button"
                          onClick={() => setAvatarEmoji(emoji)}
                          aria-label={`アイコン ${emoji}`}
                          aria-pressed={avatarEmoji === emoji}
                          className={`aspect-square rounded-xl border text-2xl ${
                            avatarEmoji === emoji
                              ? "border-black bg-gray-100"
                              : "border-gray-200 bg-white"
                          }`}
                        >
                          {emoji}
                        </button>
                      ))}
                    </div>
                    <p className="text-center text-3xl mt-3">
                      {avatarEmoji}
                    </p>
                  </div>
                )}
              </div>

              <div className="mt-5">
                <label className="block text-sm font-bold text-gray-800 mb-2">
                  活動エリア <span className="text-red-500">*</span>
                </label>

                <p className="text-xs text-gray-500 mb-3">
                  活動できる地域を自由に入力し、複数追加できます。
                </p>

                <div className="flex gap-2 mt-3">
                  <input
                    value={areaInput}
                    onChange={(e) => setAreaInput(e.target.value)}
                    placeholder="例：名古屋市、東三河、愛知県全域"
                    className={inputClass}
                    maxLength={100}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        addArea();
                      }
                    }}
                  />

                  <button
                    type="button"
                    onClick={addArea}
                    className="shrink-0 rounded-2xl bg-gray-900 text-white px-4 font-bold"
                  >
                    追加
                  </button>
                </div>

                <p className="text-xs text-gray-400 mt-2">
                  市区町村、複数の市、地域名などを入力できます。
                </p>

                {areas.length > 0 && (
                  <div className="mt-3 space-y-2">
                    {areas.map((item) => (
                      <div
                        key={item}
                        className="flex items-center justify-between gap-2 bg-blue-50 border border-blue-100 rounded-xl px-3 py-2"
                      >
                        <span className="text-sm text-gray-800">{item}</span>

                        <button
                          type="button"
                          onClick={() =>
                            setAreas((current) =>
                              current.filter((area) => area !== item)
                            )
                          }
                          className="text-sm text-red-600 font-bold"
                          aria-label="活動エリアを削除"
                        >
                          削除
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </section>

            <div className="border-t border-gray-100" />

            <section>
              <h2 className="font-bold text-gray-900 mb-2">🎵 楽器</h2>
              <p className="text-xs text-gray-500 mb-3">
                該当する楽器をすべて選択してください。
              </p>
              <div className="grid grid-cols-2 gap-2">
                {instrumentOptions.map((item) => (
                  <label
                    key={item}
                    className={`flex items-center gap-2 rounded-xl border p-3 text-sm ${
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
                    {item}
                  </label>
                ))}
              </div>

              <label className="block text-sm font-bold text-gray-800 mt-4 mb-2">
                その他の楽器（任意）
              </label>
              <input
                value={otherInstrument}
                onChange={(e) => setOtherInstrument(e.target.value)}
                placeholder="例：二胡、バンドネオン"
                className={inputClass}
              />
              <p className="text-xs text-gray-400 mt-2">
                複数ある場合は「,」または「、」で区切れます。
              </p>
            </section>

            <div className="border-t border-gray-100" />

            <section>
              <h2 className="font-bold text-gray-900 mb-2">🎼 音楽ジャンル</h2>
              <p className="text-xs text-gray-500 mb-3">
                得意なジャンルをすべて選択してください。
              </p>
              <div className="grid grid-cols-2 gap-2">
                {genreOptions.map((item) => (
                  <label
                    key={item}
                    className={`flex items-center gap-2 rounded-xl border p-3 text-sm ${
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
                    {item}
                  </label>
                ))}
              </div>

              <label className="block text-sm font-bold text-gray-800 mt-4 mb-2">
                その他のジャンル（任意）
              </label>
              <input
                value={otherGenre}
                onChange={(e) => setOtherGenre(e.target.value)}
                placeholder="例：ボサノバ、タンゴ"
                className={inputClass}
              />
            </section>

            <div className="border-t border-gray-100" />

            <section>
              <h2 className="font-bold text-gray-900 mb-3">💬 自己紹介</h2>
              <textarea
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                placeholder="演奏経験や活動内容などを入力してください"
                rows={5}
                className={`${inputClass} resize-none leading-6`}
              />
            </section>
          </div>

          <div className="bg-gray-50 border-t border-gray-100 p-5">
            <div className="bg-white border border-gray-100 rounded-2xl p-4 mb-4">
              <p className="text-xs text-gray-500 leading-5">
                活動エリア・楽器・音楽ジャンルは、施設が演奏者を探す際の条件として利用できるようにします。
              </p>
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-black text-white rounded-2xl py-4 font-bold disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? "登録中..." : "プロフィールを登録する"}
            </button>
          </div>
        </form>
      </div>
    </main>
  );
}