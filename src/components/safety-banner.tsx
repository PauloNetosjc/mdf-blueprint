import { AlertTriangle } from "lucide-react";

export function SafetyBanner() {
  return (
    <div className="flex items-start gap-2 border-b border-warning/40 bg-warning/15 px-4 py-2 text-[12px] leading-relaxed text-warning-foreground">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
      <p>
        <strong>Aviso de segurança:</strong> o G-code gerado é uma prévia técnica.
        Antes de usar em máquina real, o operador responsável deve validar o código,
        o pós-processador, a origem, as ferramentas, as faces, os avanços, a rotação
        e os limites da máquina conforme o manual técnico.
      </p>
    </div>
  );
}
