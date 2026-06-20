"use client";

import { useRef, useState } from "react";

type Status = "idle" | "loading" | "error" | "done";

type Props = {
  status: Status;
  fileName: string | null;
  onFile: (file: File) => void;
};

export default function UploadZone({ status, fileName, onFile }: Props) {
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const isLoading = status === "loading";

  const handleFiles = (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    onFile(file);
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => !isLoading && inputRef.current?.click()}
      onKeyDown={(e) => {
        if ((e.key === "Enter" || e.key === " ") && !isLoading) {
          inputRef.current?.click();
        }
      }}
      onDragOver={(e) => {
        e.preventDefault();
        if (!isLoading) setIsDragging(true);
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setIsDragging(false);
        if (!isLoading) handleFiles(e.dataTransfer.files);
      }}
      className={`mx-auto flex max-w-xl cursor-pointer flex-col items-center gap-3 rounded-xl border-2 border-dashed bg-light-blue px-8 py-12 text-center transition-colors ${
        isDragging ? "border-primary bg-light-blue/80" : "border-primary/40"
      } ${isLoading ? "cursor-wait opacity-80" : ""}`}
    >
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,.pdf"
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
      />

      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M12 16V4M12 4L7 9M12 4l5 5"
          stroke="#1565C0"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2"
          stroke="#1565C0"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>

      {isLoading ? (
        <p className="text-sm font-medium text-primary">
          Analyzing {fileName}…
        </p>
      ) : (
        <>
          <p className="text-sm font-medium text-navy">
            Drag and drop a spec sheet PDF here
          </p>
          <p className="text-xs text-secondary">or click to browse your files</p>
        </>
      )}
    </div>
  );
}
