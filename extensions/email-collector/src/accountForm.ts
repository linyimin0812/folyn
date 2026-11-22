/**
 * What the settings form shows for one mailbox — pure, so it is testable
 * without a DOM.
 */
import { hasKnownImapHost } from './emailEvents';

/** Official「generate an auth code」help pages, by mail domain.
 *  ponytail: domains without a confident official URL (sina) are absent. */
const AUTH_HELP_URLS: Record<string, string> = {
  'gmail.com': 'https://support.google.com/mail/answer/185833',
  'googlemail.com': 'https://support.google.com/mail/answer/185833',
  'qq.com': 'https://service.mail.qq.com/detail/0/75',
  'foxmail.com': 'https://service.mail.qq.com/detail/0/75',
  '163.com': 'https://help.mail.163.com/faqDetail.do?code=d1a5dc8471cd0c0128b6c9d0f5b52d16',
  '126.com': 'https://help.mail.163.com/faqDetail.do?code=d1a5dc8471cd0c0128b6c9d0f5b52d16',
  'yeah.net': 'https://help.mail.163.com/faqDetail.do?code=d1a5dc8471cd0c0128b6c9d0f5b52d16',
  'outlook.com': 'https://account.live.com/password/AppPassword',
  'hotmail.com': 'https://account.live.com/password/AppPassword',
  'live.com': 'https://account.live.com/password/AppPassword',
  'yahoo.com': 'https://help.yahoo.com/kb/SLN15241.html',
  'icloud.com': 'https://support.apple.com/zh-cn/HT204397',
};

/** The provider's「how to get an auth code」page for a mailbox, if known. */
export function authHelpUrl(username: unknown): string | null {
  return AUTH_HELP_URLS[String(username ?? '').split('@')[1]?.toLowerCase() ?? ''] ?? null;
}

/**
 * Whether a mailbox needs its IMAP server field. A provider whose host the
 * collector infers does not, so it is noise — unless the user already filled
 * a host in, which must stay visible and editable.
 */
export function showsServerFields(account: Record<string, unknown>): boolean {
  return String(account.host ?? '') !== '' || !hasKnownImapHost(String(account.username ?? ''));
}
