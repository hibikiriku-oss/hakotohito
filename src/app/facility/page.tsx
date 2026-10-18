"use client";

import { useEffect, useState } from "react";
import liff from "@line/liff";

export default function FacilityPage() {
  const [lineUserId, setLineUserId] = useState("");

  const [name, setName] = useState("");
  const [facilityType, setFacilityType] = useState("");
  const [address, setAddress] = useState("");
  const [description, setDescription] = useState("");

  const [loading, setLoading] = useState(false);

  // =========================
  // LINE / LIFF 初期化
  // =========================
  useEffect(() => {
    async function initLiff() {
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

        const profile = await liff.getProfile();

        console.log("LINEプロフィール:", profile);

        setLineUserId(profile.userId);
      } catch (error) {
        console.error("LIFF ERROR:", error);
        alert("LINE情報の取得に失敗しました");
      }
    }

    initLiff();
  }, []);

  // =========================
  // 施設プロフィール登録
  // =========================
  const handleSubmit = async (
    e: React.FormEvent<HTMLFormElement>
  ) => {
    e.preventDefault();

    if (!name || !facilityType || !address) {
      alert("必須項目を入力してください");
      return;
    }

    if (!lineUserId) {
      alert(
        "LINEユーザー情報を取得中です。少し待ってから再度お試しください。"
      );
      return;
    }

    try {
      setLoading(true);

      console.log("施設プロフィール登録開始");

      const response = await fetch("/api/facilities", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-line-user-id": lineUserId,
        },
        body: JSON.stringify({
          name,
          facilityType,
          address,
          description,
        }),
      });

      console.log("APIステータス:", response.status);

      const data = await response.json();

      console.log("API結果:", data);

      if (!response.ok) {
        alert(data.error || "登録に失敗しました");
        return;
      }

      alert("施設プロフィールを登録しました！");

      window.location.href = "/facility/home";
    } catch (error) {
      console.error("登録エラー:", error);
      alert("通信エラーが発生しました");
    } finally {
      setLoading(false);
    }
  };

  // =========================
  // 画面
  // =========================
  return (
    <main className="min-h-screen bg-gray-50">
      <div className="max-w-md mx-auto px-4 pt-6 pb-10">
        {/* ヘッダー */}
        <header className="mb-6">
          <div className="w-14 h-14 rounded-2xl bg-black text-white flex items-center justify-center text-3xl shadow-sm mb-4">
            🏢
          </div>

          <p className="text-xs font-bold tracking-wider text-gray-400 mb-2">
            施設として登録
          </p>

          <h1 className="text-2xl font-bold text-gray-900 leading-tight">
            施設プロフィール
          </h1>

          <p className="text-sm text-gray-500 mt-2 leading-6">
            演奏者に表示される施設情報を登録しましょう。
            施設の雰囲気や特徴が伝わる情報を入力すると、
            あなたの施設に合う演奏者を見つけやすくなります。
          </p>
        </header>

        {/* 登録フォーム */}
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
                    <span className="text-red-500 ml-1">
                      *
                    </span>
                  </label>

                  <input
                    type="text"
                    value={name}
                    onChange={(e) =>
                      setName(e.target.value)
                    }
                    placeholder="例：○○老人ホーム"
                    className="w-full border border-gray-200 rounded-2xl px-4 py-3.5 bg-gray-50 text-gray-900 placeholder:text-gray-400 outline-none transition focus:bg-white focus:border-black focus:ring-2 focus:ring-gray-100"
                  />
                </div>

                {/* 施設種類 */}
                <div>
                  <label className="block text-sm font-bold text-gray-800 mb-2">
                    施設種類
                    <span className="text-red-500 ml-1">
                      *
                    </span>
                  </label>

                  <select
                    value={facilityType}
                    onChange={(e) =>
                      setFacilityType(e.target.value)
                    }
                    className="w-full border border-gray-200 rounded-2xl px-4 py-3.5 bg-gray-50 text-gray-900 outline-none transition focus:bg-white focus:border-black focus:ring-2 focus:ring-gray-100"
                  >
                    <option value="">
                      選択してください
                    </option>

                    <option value="高齢者施設">
                      高齢者施設
                    </option>

                    <option value="介護施設">
                      介護施設
                    </option>

                    <option value="病院">
                      病院
                    </option>

                    <option value="障害者施設">
                      障害者施設
                    </option>

                    <option value="学校">
                      学校
                    </option>

                    <option value="保育園・幼稚園">
                      保育園・幼稚園
                    </option>

                    <option value="イベント会場">
                      イベント会場
                    </option>

                    <option value="その他">
                      その他
                    </option>
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
                  <span className="text-red-500 ml-1">
                    *
                  </span>
                </label>

                <input
                  type="text"
                  value={address}
                  onChange={(e) =>
                    setAddress(e.target.value)
                  }
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
                onChange={(e) =>
                  setDescription(e.target.value)
                }
                placeholder="施設の特徴や、演奏を依頼したい理由など"
                rows={5}
                className="w-full resize-none border border-gray-200 rounded-2xl px-4 py-3.5 bg-gray-50 text-gray-900 placeholder:text-gray-400 outline-none transition focus:bg-white focus:border-black focus:ring-2 focus:ring-gray-100 leading-6"
              />

              <p className="text-xs text-gray-400 mt-2 leading-5">
                演奏者が施設の雰囲気をイメージできる内容がおすすめです。
              </p>
            </section>
          </div>

          {/* 登録エリア */}
          <div className="bg-gray-50 border-t border-gray-100 p-5">
            <div className="bg-white border border-gray-100 rounded-2xl p-4 mb-4">
              <div className="flex items-start gap-3">
                <span className="text-lg">
                  💡
                </span>

                <div>
                  <p className="text-sm font-bold text-gray-700 mb-1">
                    登録について
                  </p>

                  <p className="text-xs text-gray-500 leading-5">
                    施設名・施設種類・住所は必須項目です。
                    登録後は施設ホーム画面からオファーを登録できます。
                  </p>
                </div>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-black text-white rounded-2xl py-4 font-bold shadow-sm transition active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  登録中...
                </span>
              ) : (
                "施設プロフィールを登録する"
              )}
            </button>

            <p className="text-center text-xs text-gray-400 mt-3">
              登録後、施設ホーム画面へ移動します。
            </p>
          </div>
        </form>
      </div>
    </main>
  );
}