"use client";

import { useEffect, useState } from "react";

type AnnouncementResponse = {
  message?: string;
  isActive?: boolean;
};

export default function AnnouncementTicker() {
  const [message, setMessage] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function loadAnnouncement() {
      try {
        const response = await fetch("/api/announcements", {
          cache: "no-store",
        });

        if (!response.ok) {
          return;
        }

        const data: AnnouncementResponse = await response.json();

        if (!cancelled) {
          setMessage(
            data.isActive && typeof data.message === "string"
              ? data.message.trim()
              : ""
          );
        }
      } catch (error) {
        console.error("Announcement ticker load error:", error);
      }
    }

    void loadAnnouncement();

    // 表示中に管理者が変更した場合も、最大60秒程度で更新する
    const timer = window.setInterval(() => {
      void loadAnnouncement();
    }, 60_000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  if (!message) {
    return null;
  }

  return (
    <section
      className="announcement-ticker"
      aria-label="管理者からのお知らせ"
      role="status"
    >
      <span className="announcement-ticker__label">
        お知らせ
      </span>

      <div className="announcement-ticker__viewport">
        <div
          className="announcement-ticker__track"
          aria-hidden="true"
        >
          <span className="announcement-ticker__message">
            {message}
          </span>
          <span className="announcement-ticker__message">
            {message}
          </span>
        </div>
      </div>

      <style jsx>{`
        .announcement-ticker {
          display: flex;
          align-items: center;
          width: 100%;
          height: 38px;
          overflow: hidden;
          border-top: 1px solid #fde68a;
          border-bottom: 1px solid #fde68a;
          background: #fffbeb;
          color: #78350f;
        }

        .announcement-ticker__label {
          z-index: 1;
          flex: 0 0 auto;
          align-self: stretch;
          display: flex;
          align-items: center;
          padding: 0 10px;
          background: #fef3c7;
          font-size: 12px;
          font-weight: 700;
          border-right: 1px solid #fde68a;
        }

        .announcement-ticker__viewport {
          flex: 1;
          min-width: 0;
          overflow: hidden;
        }

        .announcement-ticker__track {
          display: flex;
          width: max-content;
          animation: announcement-marquee 28s linear infinite;
          will-change: transform;
        }

        .announcement-ticker__message {
          flex: 0 0 auto;
          white-space: nowrap;
          padding-right: 56px;
          font-size: 13px;
          line-height: 38px;
        }

        .announcement-ticker__viewport:hover
          .announcement-ticker__track {
          animation-play-state: paused;
        }

        @keyframes announcement-marquee {
          from {
            transform: translateX(0);
          }

          to {
            transform: translateX(-50%);
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .announcement-ticker__track {
            animation: none;
          }

          .announcement-ticker__message:nth-child(2) {
            display: none;
          }
        }
      `}</style>
    </section>
  );
}