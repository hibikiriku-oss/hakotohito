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
    <main className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-md mx-auto">

        <h1 className="text-2xl font-bold mb-2">
          🏢 施設プロフィール
        </h1>

        <p className="text-gray-600 mb-6">
          演奏者に表示される施設情報を登録してください。
        </p>

        <form
          onSubmit={handleSubmit}
          className="space-y-4"
        >

          {/* 施設名 */}
          <div>
            <label className="block font-bold mb-1">
              施設名
            </label>

            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例：○○老人ホーム"
              className="w-full border rounded-xl p-3 bg-white"
            />
          </div>

          {/* 施設種類 */}
          <div>
            <label className="block font-bold mb-1">
              施設種類
            </label>

            <select
              value={facilityType}
              onChange={(e) =>
                setFacilityType(e.target.value)
              }
              className="w-full border rounded-xl p-3 bg-white"
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

          {/* 住所 */}
          <div>
            <label className="block font-bold mb-1">
              住所
            </label>

            <input
              type="text"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="例：愛知県名古屋市○○区○○"
              className="w-full border rounded-xl p-3 bg-white"
            />
          </div>

          {/* 施設紹介 */}
          <div>
            <label className="block font-bold mb-1">
              施設紹介
            </label>

            <textarea
              value={description}
              onChange={(e) =>
                setDescription(e.target.value)
              }
              placeholder="施設の特徴や演奏を依頼したい理由など"
              rows={5}
              className="w-full border rounded-xl p-3 bg-white"
            />
          </div>

          {/* 登録ボタン */}
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-black text-white rounded-xl p-4 font-bold disabled:opacity-50"
          >
            {loading
              ? "登録中..."
              : "施設プロフィールを登録する"}
          </button>

        </form>

      </div>
    </main>
  );
}