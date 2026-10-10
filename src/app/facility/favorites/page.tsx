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

  const [favoriteLoading, setFavoriteLoading] = useState(false);

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

        const profile = await liff.getProfile();

        const response = await fetch("/api/favorites", {
          headers: {
            "x-line-user-id": profile.userId,
          },
        });

        if (!response.ok) {
          throw new Error("お気に入りの取得に失敗しました");
        }

        const data = await response.json();

        setFavorites(data.favorites || []);
      } catch (err) {
        console.error(err);
        setError("お気に入りの取得に失敗しました");
      } finally {
        setLoading(false);
      }
    };

    initialize();
  }, []);

  const getUser = (favorite: Favorite): User | null => {
    if (!favorite.users) {
      return null;
    }

    if (Array.isArray(favorite.users)) {
      return favorite.users[0] ?? null;
    }

    return favorite.users;
  };

  const getPerformer = (favorite: Favorite): Performer | null => {
    const user = getUser(favorite);

    if (!user || !user.performers) {
      return null;
    }

    if (Array.isArray(user.performers)) {
      return user.performers[0] ?? null;
    }

    return user.performers;
  };

  const performerFavorites = favorites.filter((favorite) => {
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

      const profile = await liff.getProfile();

      const response = await fetch("/api/favorites", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          "x-line-user-id": profile.userId,
        },
        body: JSON.stringify({
          targetUserId: favorite.target_user_id,
        }),
      });

      if (!response.ok) {
        throw new Error("お気に入り解除に失敗しました");
      }

      setFavorites((current) =>
        current.filter((item) => item.id !== favorite.id)
      );

      setSelectedFavorite(null);
    } catch (err) {
      console.error(err);
      alert("お気に入りの解除に失敗しました");
    } finally {
      setFavoriteLoading(false);
    }
  };

  if (loading) {
    return (
      <main className="min-h-screen bg-gray-50 p-6">
        <div className="max-w-md mx-auto">
          <p className="text-center text-gray-600">
            読み込み中...
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
            onClick={() => router.push("/facility/home")}
            className="mb-6 text-gray-600"
          >
            ← 施設ホームへ戻る
          </button>

          <div className="bg-white rounded-xl p-6 text-center">
            <p className="text-red-500">
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
          onClick={() => router.push("/facility/home")}
          className="mb-6 text-gray-600"
        >
          ← 施設ホームへ戻る
        </button>

        <h1 className="text-2xl font-bold">
          ⭐ お気に入りの演奏者
        </h1>

        <p className="mt-2 text-gray-600">
          お気に入り登録した演奏者を確認できます。
        </p>

        {performerFavorites.length === 0 ? (
          <div className="mt-8 bg-white rounded-xl p-6 text-center">
            <p className="text-gray-500">
              まだお気に入りの演奏者はいません。
            </p>

            <button
              onClick={() => router.push("/facility/performers")}
              className="mt-4 w-full bg-black text-white rounded-xl p-4"
            >
              🎹 演奏者を探す
            </button>
          </div>
        ) : (
          <div className="mt-6 space-y-4">
            {performerFavorites.map((favorite) => {
              const user = getUser(favorite);
              const performer = getPerformer(favorite);

              if (!user || !performer) {
                return null;
              }

              return (
                <button
                  key={favorite.id}
                  onClick={() =>
                    setSelectedFavorite(favorite)
                  }
                  className="w-full text-left bg-white rounded-xl p-5 shadow-sm border"
                >
                  <div className="flex items-center gap-4">

                    {user.picture_url ? (
                      <img
                        src={user.picture_url}
                        alt=""
                        className="w-14 h-14 rounded-full object-cover"
                      />
                    ) : (
                      <div className="w-14 h-14 rounded-full bg-gray-200 flex items-center justify-center text-2xl">
                        🎹
                      </div>
                    )}

                    <div className="flex-1 min-w-0">
                      <h2 className="font-bold text-lg">
                        {performer.name || "名前未設定"}
                      </h2>

                      {performer.area && (
                        <p className="mt-1 text-sm text-gray-600">
                          📍 {performer.area}
                        </p>
                      )}
                    </div>

                    <div className="text-gray-400">
                      ›
                    </div>
                  </div>

                  {performer.instruments &&
                    performer.instruments.length > 0 && (
                      <p className="mt-4 text-sm">
                        🎸 {performer.instruments.join("、")}
                      </p>
                    )}

                  {performer.genres &&
                    performer.genres.length > 0 && (
                      <p className="mt-2 text-sm">
                        🎵 {performer.genres.join("、")}
                      </p>
                    )}
                </button>
              );
            })}
          </div>
        )}

        {selectedFavorite && (
          <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center">
            <div className="w-full max-w-md bg-white rounded-t-2xl sm:rounded-2xl p-6 max-h-[90vh] overflow-y-auto">

              {(() => {
                const user = getUser(selectedFavorite);
                const performer =
                  getPerformer(selectedFavorite);

                if (!user || !performer) {
                  return null;
                }

                return (
                  <>
                    <div className="flex items-center gap-4">

                      {user.picture_url ? (
                        <img
                          src={user.picture_url}
                          alt=""
                          className="w-16 h-16 rounded-full object-cover"
                        />
                      ) : (
                        <div className="w-16 h-16 rounded-full bg-gray-200 flex items-center justify-center text-3xl">
                          🎹
                        </div>
                      )}

                      <div>
                        <h2 className="text-xl font-bold">
                          {performer.name || "名前未設定"}
                        </h2>

                        {user.display_name && (
                          <p className="text-sm text-gray-500">
                            LINE表示名：{user.display_name}
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="mt-6 space-y-4">

                      {performer.area && (
                        <div>
                          <p className="text-sm font-bold text-gray-500">
                            活動エリア
                          </p>
                          <p className="mt-1">
                            {performer.area}
                          </p>
                        </div>
                      )}

                      {performer.instruments &&
                        performer.instruments.length > 0 && (
                          <div>
                            <p className="text-sm font-bold text-gray-500">
                              楽器
                            </p>
                            <p className="mt-1">
                              {performer.instruments.join("、")}
                            </p>
                          </div>
                        )}

                      {performer.genres &&
                        performer.genres.length > 0 && (
                          <div>
                            <p className="text-sm font-bold text-gray-500">
                              ジャンル
                            </p>
                            <p className="mt-1">
                              {performer.genres.join("、")}
                            </p>
                          </div>
                        )}

                      {performer.bio && (
                        <div>
                          <p className="text-sm font-bold text-gray-500">
                            自己紹介
                          </p>
                          <p className="mt-1 whitespace-pre-wrap">
                            {performer.bio}
                          </p>
                        </div>
                      )}
                    </div>

                    <div className="mt-8 space-y-3">

                      <button
                        onClick={() =>
                          handleRemoveFavorite(
                            selectedFavorite
                          )
                        }
                        disabled={favoriteLoading}
                        className="w-full bg-white border border-red-300 text-red-600 rounded-xl p-4"
                      >
                        {favoriteLoading
                          ? "変更しています..."
                          : "♥ お気に入りを解除"}
                      </button>

                      <button
                        onClick={() =>
                          setSelectedFavorite(null)
                        }
                        className="w-full bg-gray-100 rounded-xl p-4"
                      >
                        閉じる
                      </button>

                    </div>
                  </>
                );
              })()}

            </div>
          </div>
        )}

      </div>
    </main>
  );
}