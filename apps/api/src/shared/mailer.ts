export interface MailInput {
	from: string
	to: string
	subject: string
	html: string
}

export interface SendResult {
	ok: boolean
	id?: string
	error?: string
}

export interface Mailer {
	send(input: MailInput): Promise<SendResult>
}

/** Resend HTTP API — no SDK dependency, plain fetch. */
class ResendMailer implements Mailer {
	constructor(private apiKey: string) {}

	async send(input: MailInput): Promise<SendResult> {
		try {
			const res = await fetch('https://api.resend.com/emails', {
				method: 'POST',
				headers: {
					authorization: `Bearer ${this.apiKey}`,
					'content-type': 'application/json'
				},
				body: JSON.stringify({
					from: input.from,
					to: [input.to],
					subject: input.subject,
					html: input.html
				})
			})
			const body = (await res.json().catch(() => null)) as { id?: string; message?: string } | null
			if (!res.ok) {
				return { ok: false, error: body?.message ?? `Resend request failed (${res.status})` }
			}
			return { ok: true, id: body?.id }
		} catch (e) {
			return { ok: false, error: e instanceof Error ? e.message : 'Resend request failed' }
		}
	}
}

/** Used when RESEND_API_KEY is not configured — marks sends as delivered no-ops. */
class NoopMailer implements Mailer {
	async send(): Promise<SendResult> {
		return { ok: true, id: 'noop' }
	}
}

let active: Mailer | null = null

export function getMailer(): Mailer {
	active ??= process.env.RESEND_API_KEY
		? new ResendMailer(process.env.RESEND_API_KEY)
		: new NoopMailer()
	return active
}

/** Test seam — pass null to reset to the env-derived default. */
export function setMailer(mailer: Mailer | null): void {
	active = mailer
}

const escapeHtml = (value: string) =>
	value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c)

/** Minimal branded HTML layout for transactional emails. */
export function renderEmail(opts: {
	title: string
	intro: string
	storeName: string
	lines?: Array<{ label: string; value: string }>
	items?: Array<{ name: string; quantity: number; total: string }>
	total?: string
	cta?: { label: string; url: string }
	footerNote?: string
}): string {
	const rows = (opts.lines ?? [])
		.map(
			(l) =>
				`<tr><td style="padding:4px 0;color:#6b7280;font-size:13px">${escapeHtml(l.label)}</td><td style="padding:4px 0;text-align:right;font-size:13px;color:#111827">${escapeHtml(l.value)}</td></tr>`
		)
		.join('')
	const itemRows = (opts.items ?? [])
		.map(
			(i) =>
				`<tr><td style="padding:6px 0;color:#111827;font-size:14px">${escapeHtml(i.name)} &times; ${i.quantity}</td><td style="padding:6px 0;text-align:right;font-size:14px;color:#111827">${escapeHtml(i.total)}</td></tr>`
		)
		.join('')
	const cta = opts.cta
		? `<a href="${escapeHtml(opts.cta.url)}" style="display:inline-block;background:#4f46e5;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:10px 20px;border-radius:8px">${escapeHtml(opts.cta.label)}</a>`
		: ''
	const money = opts.total
		? `<tr><td style="padding:8px 0;border-top:1px solid #e5e7eb;font-weight:600;color:#111827">Total</td><td style="padding:8px 0;border-top:1px solid #e5e7eb;text-align:right;font-weight:600;color:#111827">${escapeHtml(opts.total)}</td></tr>`
		: ''
	return `<!doctype html>
<html><body style="margin:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
<div style="max-width:560px;margin:24px auto;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb">
  <div style="background:#111827;padding:16px 24px">
    <span style="color:#ffffff;font-weight:700;font-size:15px">${escapeHtml(opts.storeName)}</span>
  </div>
  <div style="padding:24px">
    <h1 style="margin:0 0 8px;font-size:18px;color:#111827">${escapeHtml(opts.title)}</h1>
    <p style="margin:0 0 16px;color:#6b7280;font-size:14px;line-height:1.5">${escapeHtml(opts.intro)}</p>
    ${(rows || itemRows || money) ? `<table style="width:100%;border-collapse:collapse">${itemRows}${rows}${money}</table>` : ''}
    ${cta ? `<div style="margin-top:20px">${cta}</div>` : ''}
    <p style="margin:20px 0 0;color:#9ca3af;font-size:12px">${escapeHtml(opts.footerNote ?? 'If you have any questions, simply reply to this email.')}</p>
  </div>
</div>
</body></html>`
}
