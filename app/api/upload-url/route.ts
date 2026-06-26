import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const body = (await request.json()) as HandleUploadBody;

  try {
    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async () => ({
        allowedContentTypes: ["application/pdf"],
        addRandomSuffix: true,
        // Allow large spec sets. The previous 50MB cap rejected the upload
        // token before processing for files at/above that size (e.g. ~56MB).
        maximumSizeInBytes: 500 * 1024 * 1024,
      }),
    });

    return NextResponse.json(jsonResponse);
  } catch (err) {
    console.error("Blob upload token error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not start the upload." },
      { status: 400 }
    );
  }
}
