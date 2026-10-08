import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(request: NextRequest) {
  try {
    // LINEユーザーIDを取得
    const lineUserId =
      request.headers.get("x-line-user-id");

    if (!lineUserId) {
      return NextResponse.json(
        {
          error: "LINEユーザー情報がありません",
        },
        { status: 400 }
      );
    }

    // ユーザーを取得
    const {
      data: user,
      error: userError,
    } = await supabase
      .from("users")
      .select("id")
      .eq("line_user_id", lineUserId)
      .single();

    if (userError || !user) {
      console.error(
        "ユーザー取得エラー:",
        userError
      );

      return NextResponse.json(
        {
          error: "ユーザー情報が見つかりません",
        },
        { status: 404 }
      );
    }

    // 演奏者プロフィールを取得
    const {
      data: performer,
      error: performerError,
    } = await supabase
      .from("performers")
      .select("id, user_id")
      .eq("user_id", user.id)
      .single();

    if (performerError || !performer) {
      console.error(
        "演奏者取得エラー:",
        performerError
      );

      return NextResponse.json(
        {
          error: "演奏者プロフィールが見つかりません",
        },
        { status: 404 }
      );
    }

    // 施設からの直接依頼を取得
    const {
      data: applications,
      error: applicationsError,
    } = await supabase
      .from("applications")
      .select(
        `
        id,
        request_id,
        performer_id,
        message,
        status,
        source,
        created_at
        `
      )
      .eq("performer_id", performer.id)
      .eq("source", "facility_invite")
      .order("created_at", {
        ascending: false,
      });

    if (applicationsError) {
      console.error(
        "依頼取得エラー:",
        applicationsError
      );

      return NextResponse.json(
        {
          error: "演奏依頼の取得に失敗しました",
        },
        { status: 500 }
      );
    }

    // 案件情報と施設情報を追加
    const invitations = [];

    for (const application of applications || []) {
      const {
        data: performanceRequest,
        error: requestError,
      } = await supabase
        .from("performance_requests")
        .select(
          "id, facility_id, title, description, performance_date, start_time, end_time, area, reward, status"
        )
        .eq("id", application.request_id)
        .single();

      if (requestError || !performanceRequest) {
        console.error(
          "案件取得エラー:",
          requestError
        );

        continue;
      }

      const {
        data: facility,
        error: facilityError,
      } = await supabase
        .from("facilities")
        .select(
          "id, name, facility_type, address, description"
        )
        .eq(
          "id",
          performanceRequest.facility_id
        )
        .single();

      if (facilityError || !facility) {
        console.error(
          "施設取得エラー:",
          facilityError
        );

        continue;
      }

      invitations.push({
        id: application.id,
        request_id: application.request_id,
        performer_id: application.performer_id,
        message: application.message,
        status: application.status,
        source: application.source,
        created_at: application.created_at,
        request: performanceRequest,
        facility,
      });
    }

    return NextResponse.json({
      invitations,
    });
  } catch (error) {
    console.error(
      "演奏依頼取得APIエラー:",
      error
    );

    return NextResponse.json(
      {
        error: "サーバーエラーが発生しました",
      },
      { status: 500 }
    );
  }
}