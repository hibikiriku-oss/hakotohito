"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import liff from "@line/liff";

type FavoriteUser = {
  id: string;
  display_name: string | null;
  picture_url: string | null;
  user_type: string | null;
};

type Favorite = {
  id: string;
  target_user_id: string;
  created_at: string;
  users: FavoriteUser | FavoriteUser[] | null;
};

export default function PerformerFavoritesPage() {
  const router = useRouter();

  const [favorites, setFavorites] =
    useState<Favorite[]>([]);

  const [loading, setLoading] =
    useState(true);

  const [error, setError] =
    useState("");

  useEffect(() => {
    async function initialize() {
      try {
        const liffId =
          process.env.NEXT_PUBLIC_LIFF_ID;

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

        const profile =
          await liff.getProfile();

        const response = await fetch(
          "/api/favorites",
          {
            headers: {
              "x-line-user-id":
                profile.userId,
            },
          }
        );

        const data =
          await response.json();

        if (!response.ok) {
          throw new Error(
            data.error ||
              "お気に入りの取得に失敗しました"
          );
        }

        setFavorites(
          data.favorites ?? []
        );
      } catch (error) {
        console.error(
          "お気に入り一覧取得エラー:",
          error
        );

        setError(
          error instanceof Error
            ? error.message
            : "お気に入りの取得中にエラーが発生しました"
        );
      } finally {
        setLoading(false);
      }
    }

    initialize();
  }, []);

  const getFavoriteUser = (
    favorite: Favorite
  ) => {
    if (Array.isArray(favorite.users)) {
      return favorite.users[0] ?? null;
    }

    return favorite.users;
  };

  if (loading) {
    return (
      <main className="min-h-screen bg-gray-50 p-6">
        <div className="max-w-md mx-auto">
          <h1 className="text-2xl font-bold">
            お気に入り
          </h1>

          <p className="mt-8 text-center text-gray-500">
            お気に入りを読み込んでいます...
          </p>
        </div>
      </main>
    );
  }

  if (error) {
    return (
      <main className="min-h-screen bg-gray-50 p-6">
        <div className="max-w-md mx-auto">
          <button
            onClick={() =>
              router.push(
                "/performer/home"
              )
            }
            className="text-sm text-gray-500 mb-4"
          >
            ← ホームへ戻る
          </button>

          <h1 className="text-2xl font-bold">
            お気に入り
          </h1>

          <div className="mt-6 bg-red-50 rounded-xl p-4">
            <p className="text-red-600">
              {error}
            </p>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-md mx-auto">

        <button
          onClick={() =>
            router.push(
              "/performer/home"
            )
          }
          className="text-sm text-gray-500 mb-4"
        >
          ← ホームへ戻る
        </button>

        <h1 className="text-2xl font-bold">
          お気に入り
        </h1>

        <p className="mt-2 text-sm text-gray-500">
          お気に入り登録した施設
        </p>

        {favorites.length === 0 ? (
          <div className="mt-8 bg-white rounded-2xl p-6 text-center shadow-sm">
            <p className="text-gray-500">
              まだお気に入りはありません。
            </p>

            <button
              onClick={() =>
                router.push(
                  "/performer/requests"
                )
              }
              className="w-full mt-5 bg-black text-white rounded-xl p-4 font-bold"
            >
              案件を探す
            </button>
          </div>
        ) : (
          <div className="mt-6 space-y-4">
            {favorites.map((favorite) => {
              const user =
                getFavoriteUser(favorite);

              return (
                <div
                  key={favorite.id}
                  className="bg-white rounded-2xl p-4 shadow-sm"
                >
                  <div className="flex items-center gap-4">

                    {user?.picture_url ? (
                      <img
                        src={user.picture_url}
                        alt=""
                        className="w-14 h-14 rounded-full object-cover"
                      />
                    ) : (
                      <div className="w-14 h-14 rounded-full bg-gray-200 flex items-center justify-center text-2xl">
                        🏢
                      </div>
                    )}

                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-lg truncate">
                        {user?.display_name ||
                          "施設"}
                      </p>

                      <p className="text-sm text-gray-500 mt-1">
                        施設
                      </p>
                    </div>

                  </div>

                  <button
                    onClick={() =>
                      alert(
                        "施設プロフィール画面は次のステップで追加します。"
                      )
                    }
                    className="w-full mt-4 border border-gray-300 rounded-xl p-3 font-bold"
                  >
                    施設プロフィールを見る
                  </button>
                </div>
              );
            })}
          </div>
        )}

      </div>
    </main>
  );
}