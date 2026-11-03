"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import liff from "@line/liff";

const avatarEmojis = [
  "🎸", "🎹", "🎤", "🥁", "🎷",
  "🎺", "🎻", "🎼", "🎵", "🎶",
  "🌟", "😊", "🌸", "🐱", "🐶",
];

type AvatarType = "line" | "emoji";

export default function FacilityProfileEditPage() {
  const router = useRouter();

  const [name, setName] = useState("");
  const [facilityType, setFacilityType] = useState("");
  const [address, setAddress] = useState("");
  const [description, setDescription] = useState("");

  const [avatarType, setAvatarType] =
    useState<AvatarType>("line");
  const [avatarEmoji, setAvatarEmoji] = useState("🏢");

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // ========================================
  // LINE認証・プロフィール取得
  // ========================================
  useEffect(() => {
    async function loadProfile() {
      try {
        const liffId = process.env.NEXT_PUBLIC_LIFF_ID;

        if (!liffId) {
          throw new Error(
            "NEXT_PUBLIC_LIFF_IDが設定されていません"
          );
        }

        await liff.init({
          liffId,
          withLoginOnExternalBrowser: true,
        });

        if (!liff.isLoggedIn()) {
          liff.login();
          return;
        }

        const idToken = liff.getIDToken();

        if (!idToken) {
          throw new Error(
            "LINEの本人確認情報を取得できません。再ログインしてください。"
          );
        }

        const response = await fetch("/api/facilities", {
          method: "GET",
          headers: {
            Authorization: `Bearer ${idToken}`,
          },
          cache: "no-store",
        });

        const data = await response.json();

        if (!response.ok) {
          throw new Error(
            data.error || "施設プロフィールの取得に失敗しました"
          );
        }

        const facility = data.facility;

        setName(facility.name ?? "");
        setFacilityType(facility.facility_type ?? "");
        setAddress(facility.address ?? "");
        setDescription(facility.description ?? "");

        setAvatarType(
          facility.avatar_type === "emoji" ? "emoji" : "line"
        );

        setAvatarEmoji(facility.avatar_emoji ?? "🏢");
      } catch (error) {
        console.error("施設プロフィール取得エラー:", error);

        alert(
          error instanceof Error
            ? error.message
            : "施設プロフィールの取得に失敗しました"
        );

        router.replace("/facility/home");
      } finally {
        setLoading(false);
      }
    }

    loadProfile();
  }, [router]);

  // ========================================
  // プロフィール更新
  // ========================================
  const handleSubmit = async (
    e: React.FormEvent<HTMLFormElement>
  ) => {
    e.preventDefault();

    if (!name.trim() || !facilityType || !address.trim()) {
      alert("施設名・施設種類・住所は必須項目です");
      return;
    }

    if (avatarType === "emoji" && !avatarEmoji.trim()) {
      alert("絵文字アイコンを選択してください");
      return;
    }

    const idToken = liff.getIDToken();

    if (!idToken) {
      alert(
        "LINEの本人確認情報を取得できません。再ログインしてください。"
      );
      return;
    }

    try {
      setSaving(true);

      const response = await fetch("/api/facilities", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          name,
          facilityType,
          address,
          description,
          avatarType,
          avatarEmoji:
            avatarType === "emoji" ? avatarEmoji : null,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        alert(data.error || "プロフィールの更新に失敗しました");
        return;
      }

      alert("施設プロフィールを更新しました！");
      router.push("/facility/home");
    } catch (error) {
      console.error("施設プロフィール更新エラー:", error);
      alert("通信エラーが発生しました");
    } finally {
      setSaving(false);
    }
  };

  // ========================================
  // 読み込み中
  // ========================================
  if (loading) {
    return (
      <main className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="w-8 h-8 border-4 border-gray-200 border-t-black rounded-full animate-spin mx-auto" />
          <p className="text-sm text-gray-500 mt-4">
            プロフィールを読み込んでいます...
          </p>
        </div>
      </main>
    );
  }

  // ========================================
  // 編集画面
  // ========================================
  return (
    <main className="min-h-screen bg-gray-50">
      <div className="max-w-md mx-auto px-4 pt-6 pb-10">
        <header className="mb-6">
          <button
            type="button"
            onClick={() => router.push("/facility/home")}
            className="text-sm text-gray-500 font-bold mb-5"
          >
            ← 施設ホームに戻る
          </button>

          <div className="w-14 h-14 rounded-2xl bg-black text-white flex items-center justify-center text-3xl shadow-sm mb-4">
            🏢
          </div>

          <p className="text-xs font-bold tracking-wider text-gray-400 mb-2">
            FACILITY PROFILE
          </p>

          <h1 className="text-2xl font-bold text-gray-900">
            施設プロフィール編集
          </h1>

          <p className="text-sm text-gray-500 mt-2 leading-6">
            登録済みの施設情報を変更できます。
            変更した内容は演奏者にも表示されます。
          </p>
        </header>

        <form
          onSubmit={handleSubmit}
          className="bg-white rounded-3xl border border-gray-100 shadow-sm overflow-hidden"
        >
          <div className="p-5 space-y-6">
            {/* 基本情報 */}
            <section>
              <div className="flex items-center gap-2 mb-4">
                <div className="w-8 h-8 rounded-xl bg-gray-100 flex items-center justify-center text-sm">
                  🏢
                </div>

                <div>
                  <p className="font-bold text-gray-900">
                    基本情報
                  </p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    施設名と施設の種類
                  </p>
                </div>
              </div>

              <div className="space-y-4">
                {/* 施設名 */}
                <div>
                  <label className="block text-sm font-bold text-gray-800 mb-2">
                    施設名
                    <span className="text-red-500 ml-1">*</span>
                  </label>

                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                    placeholder="例：○○老人ホーム"
                    className="w-full border border-gray-200 rounded-2xl px-4 py-3.5 bg-gray-50 text-gray-900 placeholder:text-gray-400 outline-none transition focus:bg-white focus:border-black focus:ring-2 focus:ring-gray-100"
                  />
                </div>

                {/* プロフィールアイコン */}
                <div>
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

                {/* 施設種類 */}
                <div>
                  <label className="block text-sm font-bold text-gray-800 mb-2">
                    施設種類
                    <span className="text-red-500 ml-1">*</span>
                  </label>

                  <select
                    value={facilityType}
                    onChange={(e) =>
                      setFacilityType(e.target.value)
                    }
                    required
                    className="w-full border border-gray-200 rounded-2xl px-4 py-3.5 bg-gray-50 text-gray-900 outline-none transition focus:bg-white focus:border-black focus:ring-2 focus:ring-gray-100"
                  >
                    <option value="">選択してください</option>
                    <option value="高齢者施設">高齢者施設</option>
                    <option value="介護施設">介護施設</option>
                    <option value="病院">病院</option>
                    <option value="障害者施設">障害者施設</option>
                    <option value="学校">学校</option>
                    <option value="保育園・幼稚園">
                      保育園・幼稚園
                    </option>
                    <option value="イベント会場">
                      イベント会場
                    </option>
                    <option value="その他">その他</option>
                  </select>
                </div>
              </div>
            </section>

            <div className="border-t border-gray-100" />

            {/* 所在地 */}
            <section>
              <div className="flex items-center gap-2 mb-4">
                <div className="w-8 h-8 rounded-xl bg-gray-100 flex items-center justify-center text-sm">
                  📍
                </div>

                <div>
                  <p className="font-bold text-gray-900">
                    所在地
                  </p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    演奏者が活動エリアを確認するための情報
                  </p>
                </div>
              </div>

              <div>
                <label className="block text-sm font-bold text-gray-800 mb-2">
                  住所
                  <span className="text-red-500 ml-1">*</span>
                </label>

                <input
                  type="text"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  required
                  placeholder="例：愛知県名古屋市○○区○○"
                  className="w-full border border-gray-200 rounded-2xl px-4 py-3.5 bg-gray-50 text-gray-900 placeholder:text-gray-400 outline-none transition focus:bg-white focus:border-black focus:ring-2 focus:ring-gray-100"
                />
              </div>
            </section>

            <div className="border-t border-gray-100" />

            {/* 施設紹介 */}
            <section>
              <div className="flex items-center gap-2 mb-4">
                <div className="w-8 h-8 rounded-xl bg-gray-100 flex items-center justify-center text-sm">
                  💬
                </div>

                <div>
                  <p className="font-bold text-gray-900">
                    施設紹介
                  </p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    施設の特徴や演奏を依頼したい理由など
                  </p>
                </div>
              </div>

              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="施設の特徴や、演奏を依頼したい理由など"
                rows={5}
                className="w-full resize-none border border-gray-200 rounded-2xl px-4 py-3.5 bg-gray-50 text-gray-900 placeholder:text-gray-400 outline-none transition focus:bg-white focus:border-black focus:ring-2 focus:ring-gray-100 leading-6"
              />

              <p className="text-xs text-gray-400 mt-2 leading-5">
                演奏者が施設の雰囲気をイメージできる内容がおすすめです。
              </p>
            </section>
          </div>

          {/* 保存エリア */}
          <div className="bg-gray-50 border-t border-gray-100 p-5">
            <div className="bg-white border border-gray-100 rounded-2xl p-4 mb-4">
              <div className="flex items-start gap-3">
                <span className="text-lg">💡</span>

                <div>
                  <p className="text-sm font-bold text-gray-700 mb-1">
                    更新について
                  </p>

                  <p className="text-xs text-gray-500 leading-5">
                    保存すると施設プロフィールに変更内容が反映されます。
                  </p>
                </div>
              </div>
            </div>

            <button
              type="submit"
              disabled={saving}
              className="w-full bg-black text-white rounded-2xl py-4 font-bold shadow-sm transition active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  保存中...
                </span>
              ) : (
                "変更内容を保存する"
              )}
            </button>

            <button
              type="button"
              onClick={() => router.push("/facility/home")}
              disabled={saving}
              className="w-full mt-3 bg-white border border-gray-200 text-gray-700 rounded-2xl py-3.5 font-bold"
            >
              キャンセル
            </button>
          </div>
        </form>
      </div>
    </main>
  );
}