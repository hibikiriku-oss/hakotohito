"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import liff from "@line/liff";

type Performer = {
  id: string;
  user_id: string;
  name: string | null;
  area: string | null;
  instruments: string[] | null;
  genres: string[] | null;
  bio: string | null;
};

type User = {
  id: string;
  display_name: string | null;
  picture_url: string | null;
  user_type: string | null;
  performers?: Performer | Performer[] | null;
};

type Favorite = {
  id: string;
  target_user_id: string;
  created_at: string;
  users: User | User[] | null;
};

export default function FacilityFavoritesPage() {
  const router = useRouter();

  const [favorites, setFavorites] = useState<Favorite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [selectedFavorite, setSelectedFavorite] =
    useState<Favorite | null>(null);

  const [favoriteLoading, setFavoriteLoading] =
    useState(false);

  useEffect(() => {
    const initialize = async () => {
      try {
        setLoading(true);
        setError("");

        await liff.init({
          liffId: process.env.NEXT_PUBLIC_LIFF_ID!,
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

        const response = await fetch("/api/favorites", {
          headers: {
            Authorization: `Bearer ${idToken}`,
          },
        });
        if (!response.ok) {
          throw new Error(
            "お気に入りの取得に失敗しました"
          );
        }

        const data = await response.json();

        setFavorites(data.favorites || []);
      } catch (err) {
        console.error(err);
        setError(
          "お気に入りの取得に失敗しました"
        );
      } finally {
        setLoading(false);
      }
    };

    initialize();
  }, []);

  const getUser = (
    favorite: Favorite
  ): User | null => {
    if (!favorite.users) {
      return null;
    }

    if (Array.isArray(favorite.users)) {
      return favorite.users[0] ?? null;
    }

    return favorite.users;
  };

  const getPerformer = (
    favorite: Favorite
  ): Performer | null => {
    const user = getUser(favorite);

    if (!user || !user.performers) {
      return null;
    }

    if (Array.isArray(user.performers)) {
      return user.performers[0] ?? null;
    }

    return user.performers;
  };

  const performerFavorites =
    favorites.filter((favorite) => {
      const user = getUser(favorite);
      const performer = getPerformer(favorite);

      return (
        user?.user_type === "performer" &&
        performer !== null
      );
    });

  const handleRemoveFavorite = async (
    favorite: Favorite
  ) => {
    if (favoriteLoading) {
      return;
    }

    try {
      setFavoriteLoading(true);

      await liff.init({
        liffId: process.env.NEXT_PUBLIC_LIFF_ID!,
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

      const response = await fetch(
        "/api/favorites",
        {
          method: "DELETE",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${idToken}`,
          },
          body: JSON.stringify({
            targetUserId:
              favorite.target_user_id,
          }),
        }
      );
      if (!response.ok) {
        throw new Error(
          "お気に入り解除に失敗しました"
        );
      }

      setFavorites((current) =>
        current.filter(
          (item) =>
            item.id !== favorite.id
        )
      );

      setSelectedFavorite(null);
    } catch (err) {
      console.error(err);
      alert(
        "お気に入りの解除に失敗しました"
      );
    } finally {
      setFavoriteLoading(false);
    }
  };

  if (loading) {
    return (
      <main className="min-h-screen bg-gray-50">
        <div className="max-w-md mx-auto min-h-screen bg-gray-50 px-4 py-8">
          <div className="animate-pulse space-y-5">
            <div className="h-4 w-28 bg-gray-200 rounded" />

            <div className="space-y-2">
              <div className="h-8 w-56 bg-gray-200 rounded" />
              <div className="h-4 w-72 bg-gray-200 rounded" />
            </div>

            <div className="bg-white rounded-2xl p-5 border border-gray-100">
              <div className="flex items-center gap-4">
                <div className="w-14 h-14 rounded-full bg-gray-200" />
                <div className="flex-1 space-y-2">
                  <div className="h-5 w-32 bg-gray-200 rounded" />
                  <div className="h-4 w-24 bg-gray-200 rounded" />
                </div>
              </div>

              <div className="mt-4 h-4 w-40 bg-gray-200 rounded" />
              <div className="mt-2 h-4 w-48 bg-gray-200 rounded" />
            </div>

            <div className="bg-white rounded-2xl p-5 border border-gray-100">
              <div className="flex items-center gap-4">
                <div className="w-14 h-14 rounded-full bg-gray-200" />
                <div className="flex-1 space-y-2">
                  <div className="h-5 w-32 bg-gray-200 rounded" />
                  <div className="h-4 w-24 bg-gray-200 rounded" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    );
  }

  if (error) {
    return (
      <main className="min-h-screen bg-gray-50">
        <div className="max-w-md mx-auto min-h-screen px-4 py-6">
          <button
            onClick={() =>
              router.push("/facility/home")
            }
            className="inline-flex items-center text-sm font-medium text-gray-500 hover:text-gray-900"
          >
            ← 施設ホームへ戻る
          </button>

          <div className="mt-8 bg-white rounded-2xl border border-red-100 p-6 text-center shadow-sm">
            <div className="mx-auto w-12 h-12 rounded-full bg-red-50 flex items-center justify-center text-xl">
              !
            </div>

            <h1 className="mt-4 font-bold text-gray-900">
              読み込みに失敗しました
            </h1>

            <p className="mt-2 text-sm text-red-500">
              {error}
            </p>

            <button
              onClick={() =>
                window.location.reload()
              }
              className="mt-5 w-full rounded-xl bg-black px-4 py-3 text-sm font-bold text-white"
            >
              もう一度読み込む
            </button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="max-w-md mx-auto min-h-screen px-4 pb-10">

        {/* ヘッダー */}
        <header className="pt-6">
          <button
            onClick={() =>
              router.push("/facility/home")
            }
            className="inline-flex items-center text-sm font-medium text-gray-500"
          >
            ← 施設ホームへ戻る
          </button>

          <div className="mt-6">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-bold tracking-wider text-gray-400">
                  FAVORITES
                </p>

                <h1 className="mt-1 text-2xl font-bold tracking-tight text-gray-900">
                  ⭐ お気に入り
                </h1>
              </div>

              <div className="shrink-0 rounded-full bg-white border border-gray-200 px-3 py-1.5">
                <span className="text-sm font-bold text-gray-900">
                  {performerFavorites.length}
                </span>
                <span className="ml-1 text-xs text-gray-500">
                  人
                </span>
              </div>
            </div>

            <p className="mt-2 text-sm leading-6 text-gray-500">
              気になる演奏者を保存して、
              次のオファーにつなげましょう。
            </p>
          </div>
        </header>

        {/* お気に入り一覧 */}
        {performerFavorites.length === 0 ? (
          <section className="mt-8 rounded-2xl border border-gray-100 bg-white p-7 text-center shadow-sm">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-gray-100 text-3xl">
              ⭐
            </div>

            <h2 className="mt-5 text-lg font-bold text-gray-900">
              まだお気に入りがありません
            </h2>

            <p className="mt-2 text-sm leading-6 text-gray-500">
              気になる演奏者を見つけたら、
              お気に入りに登録しておくと
              すぐに確認できます。
            </p>

            <button
              onClick={() =>
                router.push(
                  "/facility/performers"
                )
              }
              className="mt-6 w-full rounded-xl bg-black px-4 py-3.5 text-sm font-bold text-white shadow-sm"
            >
              🎹 演奏者を探す
            </button>
          </section>
        ) : (
          <section className="mt-6 space-y-3">
            {performerFavorites.map(
              (favorite) => {
                const user =
                  getUser(favorite);

                const performer =
                  getPerformer(favorite);

                if (!user || !performer) {
                  return null;
                }

                return (
                  <button
                    key={favorite.id}
                    onClick={() =>
                      setSelectedFavorite(
                        favorite
                      )
                    }
                    className="group w-full rounded-2xl border border-gray-100 bg-white p-4 text-left shadow-sm transition active:scale-[0.99]"
                  >
                    <div className="flex items-center gap-4">
                      {user.picture_url ? (
                        <img
                          src={user.picture_url}
                          alt=""
                          className="h-14 w-14 shrink-0 rounded-full object-cover ring-2 ring-gray-100"
                        />
                      ) : (
                        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-gray-100 text-2xl">
                          🎹
                        </div>
                      )}

                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <h2 className="truncate text-lg font-bold text-gray-900">
                              {performer.name ||
                                "名前未設定"}
                            </h2>

                            {performer.area && (
                              <p className="mt-1 truncate text-sm text-gray-500">
                                📍 {performer.area}
                              </p>
                            )}
                          </div>

                          <span className="shrink-0 text-xl text-gray-300 transition group-hover:text-gray-500">
                            ›
                          </span>
                        </div>
                      </div>
                    </div>

                    {(performer.instruments?.length ||
                      performer.genres?.length) ? (
                      <div className="mt-4 flex flex-wrap gap-2">
                        {performer.instruments?.map(
                          (instrument) => (
                            <span
                              key={instrument}
                              className="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-600"
                            >
                              🎸 {instrument}
                            </span>
                          )
                        )}

                        {performer.genres?.map(
                          (genre) => (
                            <span
                              key={genre}
                              className="rounded-full bg-gray-50 px-3 py-1 text-xs font-medium text-gray-500 ring-1 ring-gray-200"
                            >
                              🎵 {genre}
                            </span>
                          )
                        )}
                      </div>
                    ) : null}
                  </button>
                );
              }
            )}
          </section>
        )}

        <p className="mt-10 text-center text-xs text-gray-400">
          気になる演奏者をお気に入りに保存できます
        </p>
      </div>

      {/* プロフィールモーダル */}
      {selectedFavorite && (
        <div
          className="fixed inset-0 z-50 bg-black/40"
          onClick={() =>
            setSelectedFavorite(null)
          }
        >
          <div
            className="absolute bottom-0 left-0 right-0 mx-auto max-h-[90vh] max-w-md overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:bottom-auto sm:top-1/2 sm:-translate-y-1/2 sm:rounded-3xl"
            onClick={(event) =>
              event.stopPropagation()
            }
          >
            {(() => {
              const user =
                getUser(selectedFavorite);

              const performer =
                getPerformer(selectedFavorite);

              if (!user || !performer) {
                return null;
              }

              return (
                <>
                  {/* モーダルヘッダー */}
                  <div className="sticky top-0 z-10 border-b border-gray-100 bg-white px-5 py-4">
                    <div className="flex items-center justify-between">
                      <h2 className="font-bold text-gray-900">
                        演奏者プロフィール
                      </h2>

                      <button
                        onClick={() =>
                          setSelectedFavorite(null)
                        }
                        className="flex h-9 w-9 items-center justify-center rounded-full bg-gray-100 text-gray-500"
                        aria-label="閉じる"
                      >
                        ×
                      </button>
                    </div>
                  </div>

                  <div className="max-h-[calc(90vh-65px)] overflow-y-auto px-5 pb-6">
                    {/* プロフィール */}
                    <div className="pt-6">
                      <div className="flex items-center gap-4">
                        {user.picture_url ? (
                          <img
                            src={user.picture_url}
                            alt=""
                            className="h-16 w-16 shrink-0 rounded-full object-cover ring-2 ring-gray-100"
                          />
                        ) : (
                          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-gray-100 text-3xl">
                            🎹
                          </div>
                        )}

                        <div className="min-w-0">
                          <h3 className="text-xl font-bold text-gray-900">
                            {performer.name ||
                              "名前未設定"}
                          </h3>

                          {user.display_name && (
                            <p className="mt-1 truncate text-sm text-gray-500">
                              LINE表示名：
                              {user.display_name}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* 詳細 */}
                    <div className="mt-7 space-y-5">
                      {performer.area && (
                        <div>
                          <p className="text-xs font-bold tracking-wide text-gray-400">
                            活動エリア
                          </p>
                          <p className="mt-1.5 text-sm text-gray-800">
                            📍 {performer.area}
                          </p>
                        </div>
                      )}

                      {performer.instruments &&
                        performer.instruments.length >
                          0 && (
                          <div>
                            <p className="text-xs font-bold tracking-wide text-gray-400">
                              楽器
                            </p>

                            <div className="mt-2 flex flex-wrap gap-2">
                              {performer.instruments.map(
                                (instrument) => (
                                  <span
                                    key={instrument}
                                    className="rounded-full bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-700"
                                  >
                                    🎸 {instrument}
                                  </span>
                                )
                              )}
                            </div>
                          </div>
                        )}

                      {performer.genres &&
                        performer.genres.length >
                          0 && (
                          <div>
                            <p className="text-xs font-bold tracking-wide text-gray-400">
                              ジャンル
                            </p>

                            <div className="mt-2 flex flex-wrap gap-2">
                              {performer.genres.map(
                                (genre) => (
                                  <span
                                    key={genre}
                                    className="rounded-full bg-gray-50 px-3 py-1.5 text-xs font-medium text-gray-600 ring-1 ring-gray-200"
                                  >
                                    🎵 {genre}
                                  </span>
                                )
                              )}
                            </div>
                          </div>
                        )}

                      {performer.bio && (
                        <div>
                          <p className="text-xs font-bold tracking-wide text-gray-400">
                            自己紹介
                          </p>

                          <div className="mt-2 rounded-xl bg-gray-50 p-4">
                            <p className="whitespace-pre-wrap text-sm leading-6 text-gray-700">
                              {performer.bio}
                            </p>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* アクション */}
                    <div className="mt-8 space-y-3">
                      <button
                        onClick={() =>
                          handleRemoveFavorite(
                            selectedFavorite
                          )
                        }
                        disabled={
                          favoriteLoading
                        }
                        className="w-full rounded-xl border border-red-200 bg-white px-4 py-3.5 text-sm font-bold text-red-600 disabled:opacity-50"
                      >
                        {favoriteLoading
                          ? "変更しています..."
                          : "♥ お気に入りを解除"}
                      </button>

                      <button
                        onClick={() =>
                          setSelectedFavorite(
                            null
                          )
                        }
                        className="w-full rounded-xl bg-gray-100 px-4 py-3.5 text-sm font-bold text-gray-700"
                      >
                        閉じる
                      </button>
                    </div>
                  </div>
                </>
              );
            })()}
          </div>
        </div>
      )}
    </main>
  );
}