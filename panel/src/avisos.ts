// Avisos por email a la promotora (función «avisar-promotora», 012): planos
// para validar, documento rechazado y versión publicada. Devuelve una frase
// para mostrar en el Panel; si el aviso falla, lo hecho no se deshace.

import { sb } from './comun';

export async function avisarPromotora(cuerpo: Record<string, unknown>): Promise<string> {
	const { data, error } = await sb.functions.invoke('avisar-promotora', { body: cuerpo });
	if (error) {
		let texto = error.message;
		try { texto = (await (error as { context?: Response }).context?.json())?.error ?? texto; } catch { /* sin detalle */ }
		return `No se ha podido avisar por email a la promotora: ${texto}`;
	}
	const r = data as { enviado: boolean; destinatarios?: number; motivo?: string };
	return r.enviado ? `Avisado por email a ${r.destinatarios} persona${r.destinatarios === 1 ? '' : 's'} de la promotora.`
		: `Sin aviso por email: ${r.motivo ?? 'no se ha enviado'}.`;
}
