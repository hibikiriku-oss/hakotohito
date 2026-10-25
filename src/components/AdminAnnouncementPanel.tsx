"use client";

import { useCallback, useEffect, useState } from "react";

type Announcement = {
  message: string;
  is_active: boolean;
  updated_at: string;
  updated_by_line_user_id: string | null;
};

type ApiResponse = {
  success?: boolean;
  error?: string;
  message?: string;
  announcement?: Announcement;
};

export default function AdminAnnouncementPanel({
  token,
}: {
  token: string;
}) {
  const [message, setMessage] = useState("");
  const [isActive, setIsActive] = useState(false);
  const [updatedAt, setUpdatedAt] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const loadAnnouncement = useCallback(async () => {
    if (!token) {
      setLoading(false);
      setError("LINEの本人確認情報を取得できません。");
      return;
    }

    setLoading(true);
    setError("");
    setNotice("");

    try {
      const response = await fetch("/api/admin/announcements", {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
        },
        cache: "no-store",
      });

      const data: ApiResponse = await response.json();

      if (!response.ok || !data.announcement) {
        throw new Error(
          data.error || "お知らせを読み込めませんでした。"
        );
      }

      setMessage(data.announcement.message ?? "");
      setIsActive(data.announcement.is_active ?? false);
      setUpdatedAt(data.announcement.updated_at ?? "");
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "お知らせの読み込みに失敗しました。"
      );
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void loadAnnouncement();
  }, [loadAnnouncement]);

  async function saveAnnouncement() {
    if (!token || saving) return;

    const trimmedMessage = message.trim();

    if (trimmedMessage.length > 500) {
      setError("お知らせは500文字以内で入力してください。");
      return;
    }

    if (isActive && !trimmedMessage) {
      setError("公開する場合は、お知らせ本文を入力してください。");
      return;
    }

    const confirmed = window.confirm(
      isActive
        ? "このお知らせを保存して公開します。演奏者と施設のホーム画面に表示されます。よろしいですか？"
        : "このお知らせを保存して非公開にします。ホーム画面には表示されなくなります。よろしいですか？"
    );

    if (!confirmed) return;

    setSaving(true);
    setError("");
    setNotice("");

    try {
      const response = await fetch("/api/admin/announcements", {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: trimmedMessage,
          isActive,
        }),
      });

      const data: ApiResponse = await response.json();

      if (!response.ok || !data.announcement) {
        throw new Error(
          data.error || "お知らせを保存できませんでした。"
        );
      }

      setMessage(data.announcement.message ?? "");
      setIsActive(data.announcement.is_active ?? false);
      setUpdatedAt(data.announcement.updated_at ?? "");

      setNotice(
        data.message || "お知らせを保存しました。"
      );
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "お知らせの保存に失敗しました。"
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="rounded-2xl bg-white p-5 shadow-sm">
      <h2 className="text-lg font-bold">
        管理者からのお知らせ
      </h2>

      <p className="mt-2 text-sm leading-6 text-gray-600">
        入力した内容は演奏者と施設、両方のホーム画面上部に
        テロップで表示されます。公開中は右から左へ繰り返し流れます。
      </p>

      {error && (
        <div
          role="alert"
          className="mt-4 whitespace-pre-wrap rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700"
        >
          {error}
        </div>
      )}

      {notice && (
        <div
          role="status"
          className="mt-4 whitespace-pre-wrap rounded-xl border border-green-200 bg-green-50 p-3 text-sm text-green-800"
        >
          {notice}
        </div>
      )}

      {loading ? (
        <p className="mt-6 text-center text-gray-500">
          お知らせを読み込んでいます…
        </p>
      ) : (
        <div className="mt-5 space-y-4">
          <div>
            <label
              htmlFor="admin-announcement-message"
              className="mb-2 block font-bold"
            >
              お知らせ本文
            </label>

            <textarea
              id="admin-announcement-message"
              value={message}
              onChange={(event) => {
                setMessage(event.target.value);
                setError("");
              }}
              maxLength={500}
              rows={5}
              placeholder="例：メンテナンスのお知らせ。10月30日 22時からサービスを一時停止します。"
              disabled={saving}
              className="w-full rounded-xl border border-gray-300 p-3 leading-6 outline-none focus:border-black disabled:bg-gray-100"
            />

            <p className="mt-1 text-right text-xs text-gray-500">
              {message.length}/500文字
            </p>
          </div>

          <label className="flex cursor-pointer items-start gap-3 rounded-xl border p-4">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(event) => {
                setIsActive(event.target.checked);
                setError("");
              }}
              disabled={saving}
              className="mt-1 h-4 w-4"
            />

            <span>
              <span className="block font-bold">
                ホーム画面に公開する
              </span>
              <span className="mt-1 block text-sm leading-5 text-gray-500">
                チェックを外して保存すると、テロップが非表示になります。
                お知らせ本文は保存されるため、あとから再公開できます。
              </span>
            </span>
          </label>

          <div className="flex flex-col gap-3 sm:flex-row">
            <button
              type="button"
              onClick={() => void saveAnnouncement()}
              disabled={saving}
              className="flex-1 rounded-xl bg-black p-4 font-bold text-white disabled:opacity-50"
            >
              {saving
                ? "保存しています…"
                : isActive
                  ? "保存して公開"
                  : "保存して非公開"}
            </button>

            <button
              type="button"
              onClick={() => void loadAnnouncement()}
              disabled={loading || saving}
              className="rounded-xl border p-4 font-bold disabled:opacity-50"
            >
              保存内容を再読み込み
            </button>
          </div>

          {updatedAt && (
            <p className="text-xs text-gray-500">
              最終更新：
              {new Date(updatedAt).toLocaleString("ja-JP")}
            </p>
          )}
        </div>
      )}
    </section>
  );
}