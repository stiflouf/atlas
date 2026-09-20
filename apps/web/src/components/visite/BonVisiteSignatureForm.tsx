"use client";

import { useState } from "react";
import Button from "@/components/ui/Button";
import SignatureCanvas from "@/components/visite/SignatureCanvas";
import { signerBonVisiteAction } from "@/actions/bonVisite";
import type { RoleSignataire } from "@/types/bonVisite";

type Props = {
  bonVisiteId: string;
  visiteId: string;
  prenomInitial?: string;
  nomInitial: string;
  emailInitial?: string;
};

const LABEL_ROLE: Record<RoleSignataire, string> = { principal: "Signataire principal", secondaire: "Second signataire" };

// §28/§29/§30 : le bouton "Signer" reste désactivé côté client tant que la signature est vide ou
// le consentement non coché — un confort d'usage, jamais la seule garantie (signerBonVisiteAction
// revalide indépendamment les deux, §44).
export default function BonVisiteSignatureForm({ bonVisiteId, visiteId, prenomInitial, nomInitial, emailInitial }: Props) {
  const [signatureVide, setSignatureVide] = useState(true);
  const [consentement, setConsentement] = useState(false);

  return (
    <form action={signerBonVisiteAction} className="flex flex-col gap-4">
      <input type="hidden" name="bonVisiteId" value={bonVisiteId} />
      <input type="hidden" name="visiteId" value={visiteId} />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className="text-[12px] font-medium text-text-2 mb-1 block">Prénom</label>
          <input
            type="text"
            name="prenomSignataire"
            defaultValue={prenomInitial ?? ""}
            className="w-full border border-border-md rounded-lg px-3 py-2 text-[14px] text-text-1 focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent"
          />
        </div>
        <div>
          <label className="text-[12px] font-medium text-text-2 mb-1 block">Nom</label>
          <input
            type="text"
            name="nomSignataire"
            required
            defaultValue={nomInitial}
            className="w-full border border-border-md rounded-lg px-3 py-2 text-[14px] text-text-1 focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent"
          />
        </div>
      </div>

      <div>
        <label className="text-[12px] font-medium text-text-2 mb-1 block">Email (optionnel)</label>
        <input
          type="email"
          name="emailSignataire"
          defaultValue={emailInitial ?? ""}
          className="w-full border border-border-md rounded-lg px-3 py-2 text-[14px] text-text-1 focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent"
        />
      </div>

      <div>
        <label className="text-[12px] font-medium text-text-2 mb-1 block">Rôle</label>
        <select
          name="roleSignataire"
          defaultValue="principal"
          className="w-full border border-border-md rounded-lg px-3 py-2 text-[14px] text-text-1 focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent"
        >
          {(Object.keys(LABEL_ROLE) as RoleSignataire[]).map((role) => (
            <option key={role} value={role}>
              {LABEL_ROLE[role]}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="text-[12px] font-medium text-text-2 mb-1 block">Signature</label>
        <SignatureCanvas onDrawingChange={setSignatureVide} />
      </div>

      <label className="inline-flex items-start gap-2 text-[13px] text-text-1">
        <input
          type="checkbox"
          name="consentement"
          checked={consentement}
          onChange={(e) => setConsentement(e.target.checked)}
          className="mt-0.5"
        />
        Je reconnais avoir pris connaissance du texte ci-dessus et je le signe volontairement.
      </label>

      <Button type="submit" variant="primary" size="md" disabled={signatureVide || !consentement} className="self-start">
        Signer le bon de visite
      </Button>
    </form>
  );
}
