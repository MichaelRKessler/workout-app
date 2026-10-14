"use client";

import { useEffect, useRef } from "react";

const COLORS = ["#e4572e", "#f2b134", "#3fa34d", "#2f80ed", "#9b51e0", "#ef476f"];
const PIECES = 90;
const DURATION_MS = 2200;

/** True when the viewer asked the system for less motion. */
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return true;
  }
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * One short burst from the top of the screen, then gone. It never takes taps
 * and is skipped when the system asks for reduced motion.
 */
export function Confetti() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || prefersReducedMotion()) {
      return;
    }
    const context = canvas.getContext?.("2d");
    if (!context) {
      return;
    }
    const ratio = window.devicePixelRatio || 1;
    const width = window.innerWidth;
    const height = window.innerHeight;
    canvas.width = width * ratio;
    canvas.height = height * ratio;
    context.scale(ratio, ratio);

    const pieces = Array.from({ length: PIECES }, () => ({
      x: width / 2 + (Math.random() - 0.5) * width * 0.3,
      y: height * 0.18,
      vx: (Math.random() - 0.5) * 9,
      vy: -Math.random() * 9 - 4,
      size: 5 + Math.random() * 6,
      spin: (Math.random() - 0.5) * 0.3,
      angle: Math.random() * Math.PI,
      color: COLORS[Math.floor(Math.random() * COLORS.length)] ?? "#e4572e",
    }));

    let frame = 0;
    const started = performance.now();
    const draw = (now: number) => {
      const elapsed = now - started;
      context.clearRect(0, 0, width, height);
      context.globalAlpha = Math.max(0, 1 - Math.max(0, elapsed - DURATION_MS * 0.6) / (DURATION_MS * 0.4));
      for (const piece of pieces) {
        piece.vy += 0.25;
        piece.vx *= 0.99;
        piece.x += piece.vx;
        piece.y += piece.vy;
        piece.angle += piece.spin;
        context.save();
        context.translate(piece.x, piece.y);
        context.rotate(piece.angle);
        context.fillStyle = piece.color;
        context.fillRect(-piece.size / 2, -piece.size / 4, piece.size, piece.size / 2);
        context.restore();
      }
      if (elapsed < DURATION_MS) {
        frame = requestAnimationFrame(draw);
      } else {
        context.clearRect(0, 0, width, height);
      }
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-50 h-dvh w-screen"
    />
  );
}
