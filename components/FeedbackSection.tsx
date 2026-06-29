"use client";

import { useState } from "react";

type SubmitState = "idle" | "sending" | "success" | "error";

export default function FeedbackSection() {
  const [feedback, setFeedback] = useState("");
  const [state, setState] = useState<SubmitState>("idle");
  const [message, setMessage] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!feedback.trim() || state === "sending") return;

    setState("sending");
    setMessage(null);

    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ feedback }),
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Could not send your feedback.");
      }

      setState("success");
      setMessage("Thanks! Your feedback was sent.");
      setFeedback("");
    } catch (err) {
      setState("error");
      setMessage(
        err instanceof Error ? err.message : "Could not send your feedback."
      );
    }
  };

  return (
    <section className="w-full bg-white">
      <div className="mx-auto max-w-2xl px-6 py-14">
        <h2 className="text-lg font-semibold text-navy">Send us feedback</h2>
        <p className="mt-1 text-sm text-secondary">
          Noticed something off, or have an idea? Let us know.
        </p>

        <form onSubmit={handleSubmit} className="mt-5 flex flex-col gap-3">
          <textarea
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            rows={4}
            maxLength={5000}
            placeholder="Your feedback…"
            className="w-full resize-y rounded-lg border border-light-blue bg-white px-4 py-3 text-sm text-navy outline-none placeholder:text-secondary focus:border-primary focus:ring-2 focus:ring-primary/20"
          />
          <div className="flex items-center gap-4">
            <button
              type="submit"
              disabled={!feedback.trim() || state === "sending"}
              className="rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {state === "sending" ? "Sending…" : "Send feedback"}
            </button>
            {message && (
              <p
                className={`text-sm font-medium ${
                  state === "error" ? "text-red-600" : "text-teal"
                }`}
                role="status"
              >
                {message}
              </p>
            )}
          </div>
        </form>
      </div>
    </section>
  );
}
