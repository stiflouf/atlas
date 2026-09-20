"use client";

import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import Button from "@/components/ui/Button";

// Capture de signature tactile/souris DOMIORA-native (§8 du brief VISIT_SIGNED_FORM_V1) — un
// canvas simple, aucune bibliothèque externe. Fond TRANSPARENT (jamais rempli) : c'est ce qui
// permet au serveur de distinguer un canvas jamais touché d'un trait réellement dessiné
// (validerEtDecoderSignatureImage, §29 — jamais une simple vérification de chaîne non vide).
//
// Responsive (§27) : le canvas suit la largeur de son conteneur via une résolution interne fixe
// redimensionnée en CSS, exploitable au doigt (tablette/téléphone) comme à la souris (desktop).
//
// Le hidden input `signatureImage` (name attendu par signerBonVisiteAction) porte le data URL PNG
// courant — mis à jour à chaque fin de trait, jamais en continu (inutile avant la fin du geste).
type Props = {
  onDrawingChange?: (estVide: boolean) => void;
};

const LARGEUR_INTERNE = 600;
const HAUTEUR_INTERNE = 220;

export default function SignatureCanvas({ onDrawingChange }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dessinEnCoursRef = useRef(false);
  const aDessineRef = useRef(false);
  const [estVide, setEstVide] = useState(true);

  function positionDepuisEvenement(e: ReactPointerEvent<HTMLCanvasElement>): { x: number; y: number } {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const echelleX = LARGEUR_INTERNE / rect.width;
    const echelleY = HAUTEUR_INTERNE / rect.height;
    return { x: (e.clientX - rect.left) * echelleX, y: (e.clientY - rect.top) * echelleY };
  }

  function demarrerTrait(e: ReactPointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.setPointerCapture(e.pointerId);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const { x, y } = positionDepuisEvenement(e);
    ctx.strokeStyle = "#1a1a1a";
    ctx.lineWidth = 2.4;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(x, y);
    dessinEnCoursRef.current = true;
  }

  function continuerTrait(e: ReactPointerEvent<HTMLCanvasElement>) {
    if (!dessinEnCoursRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!ctx) return;
    const { x, y } = positionDepuisEvenement(e);
    ctx.lineTo(x, y);
    ctx.stroke();
    aDessineRef.current = true;
  }

  function terminerTrait() {
    if (!dessinEnCoursRef.current) return;
    dessinEnCoursRef.current = false;
    if (aDessineRef.current) {
      const canvas = canvasRef.current;
      if (canvas && inputRef.current) {
        inputRef.current.value = canvas.toDataURL("image/png");
      }
      setEstVide(false);
      onDrawingChange?.(false);
    }
  }

  function effacer() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (inputRef.current) inputRef.current.value = "";
    aDessineRef.current = false;
    setEstVide(true);
    onDrawingChange?.(true);
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="border border-border-md rounded-lg bg-white touch-none">
        <canvas
          ref={canvasRef}
          width={LARGEUR_INTERNE}
          height={HAUTEUR_INTERNE}
          className="w-full h-[160px] md:h-[200px] touch-none cursor-crosshair rounded-lg"
          onPointerDown={demarrerTrait}
          onPointerMove={continuerTrait}
          onPointerUp={terminerTrait}
          onPointerLeave={terminerTrait}
          onPointerCancel={terminerTrait}
        />
      </div>
      <input ref={inputRef} type="hidden" name="signatureImage" />
      <div className="flex items-center justify-between">
        <p className="text-[11px] text-text-3">Signez dans le cadre ci-dessus, au doigt ou à la souris.</p>
        <Button type="button" variant="ghost" size="sm" onClick={effacer} disabled={estVide}>
          Effacer
        </Button>
      </div>
    </div>
  );
}
