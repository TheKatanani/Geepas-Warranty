/**
 * WhatsApp template messaging helper.
 * Currently logs only — replace the body of sendWhatsappTemplate
 * with a real API call (e.g. Meta Cloud API) when ready.
 */

export async function sendWhatsappTemplate(
  phone: string,
  templateName: string,
  params: string[]
): Promise<void> {
  console.log("[whatsapp] sendWhatsappTemplate", { phone, templateName, params });
  // TODO: call Meta WhatsApp Cloud API here
}
