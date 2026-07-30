import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';

vi.mock('../shopify.server', () => ({
  authenticate: { webhook: vi.fn() },
  unauthenticated: { admin: vi.fn() },
}));

vi.mock('../db.server', () => ({
  default: {
    sMSLog: { create: vi.fn() },
  },
}));

vi.mock('../services/infobip.server', () => ({
  sendWhatsAppTemplate: vi.fn(),
}));

import { authenticate, unauthenticated } from '../shopify.server';
import prisma from '../db.server';
import { sendWhatsAppTemplate } from '../services/infobip.server';
import { action } from '../routes/webhooks.gift_cards.create';

const webhookMock = authenticate.webhook as unknown as Mock;
const adminMock = unauthenticated.admin as unknown as Mock;
const sendWhatsAppMock = sendWhatsAppTemplate as unknown as Mock;
const smsLogCreateMock = prisma.sMSLog.create as unknown as Mock;

function runAction(payload: Record<string, any>, shop = 'test.myshopify.com') {
  webhookMock.mockResolvedValue({ shop, payload, topic: 'GIFT_CARDS_CREATE' });
  return action({
    request: new Request('https://example.com/webhooks/gift_cards/create', { method: 'POST' }),
  } as any);
}

beforeEach(() => {
  vi.clearAllMocks();
  sendWhatsAppMock.mockResolvedValue({ success: true, messageId: 'msg-giftcard-1' });
  smsLogCreateMock.mockResolvedValue({ id: 1 });
});

describe('GIFT_CARDS_CREATE webhook handler', () => {
  it('sends WhatsApp notification with correct template data when Recipient Phone is present in line item properties', async () => {
    const graphqlMock = vi.fn().mockResolvedValue({
      json: async () => ({
        data: {
          giftCard: {
            id: 'gid://shopify/GiftCard/100',
            code: 'GIFT-1234-5678',
            maskedCode: '•••• •••• •••• 5678',
            lineItem: {
              id: 'gid://shopify/LineItem/200',
              customAttributes: [
                { key: 'Recipient Phone', value: '07701234567' },
                { key: 'Recipient name', value: 'Ahmad' },
              ],
              order: {
                id: 'gid://shopify/Order/300',
                customer: { firstName: 'Buyer', phone: '+9647700000000' },
              },
            },
          },
        },
      }),
    });
    adminMock.mockResolvedValue({ admin: { graphql: graphqlMock } });

    const payload = {
      id: 100,
      initial_value: '50000.00',
      currency: 'IQD',
    };

    const res = await runAction(payload);
    expect(res.status).toBe(200);

    expect(sendWhatsAppMock).toHaveBeenCalledTimes(1);
    expect(sendWhatsAppMock).toHaveBeenCalledWith({
      phoneNumber: '+9647701234567',
      templateName: 'gift_card_notification',
      placeholders: [
        'Ahmad',
        '50,000 IQD',
        'GIFT-1234-5678',
        'Ahmad',
        '50,000 IQD',
        'GIFT-1234-5678',
      ],
      language: 'ar',
      shop: 'test.myshopify.com',
      registrationId: 'giftcard-100',
    });

    expect(smsLogCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        shop: 'test.myshopify.com',
        phone: '+9647701234567',
        smsSent: true,
      }),
    });
  });

  it('gracefully skips WhatsApp attempt when no phone number is present, without error', async () => {
    const graphqlMock = vi.fn().mockResolvedValue({
      json: async () => ({
        data: {
          giftCard: {
            id: 'gid://shopify/GiftCard/101',
            maskedCode: '•••• •••• •••• 1111',
            lineItem: {
              id: 'gid://shopify/LineItem/201',
              customAttributes: [
                { key: 'Recipient name', value: 'Sara' },
              ],
              order: {
                id: 'gid://shopify/Order/301',
                customer: { firstName: 'Buyer' },
              },
            },
          },
        },
      }),
    });
    adminMock.mockResolvedValue({ admin: { graphql: graphqlMock } });

    const payload = {
      id: 101,
      initial_value: '25000.00',
      currency: 'IQD',
    };

    const res = await runAction(payload);
    expect(res.status).toBe(200);
    expect(sendWhatsAppMock).not.toHaveBeenCalled();
    expect(smsLogCreateMock).not.toHaveBeenCalled();
  });

  it('gracefully handles manually issued gift card with no originating order or line item', async () => {
    const graphqlMock = vi.fn().mockResolvedValue({
      json: async () => ({
        data: {
          giftCard: {
            id: 'gid://shopify/GiftCard/102',
            maskedCode: '•••• •••• •••• 9999',
            lineItem: null,
          },
        },
      }),
    });
    adminMock.mockResolvedValue({ admin: { graphql: graphqlMock } });

    const payload = {
      id: 102,
      initial_value: '100000.00',
      currency: 'IQD',
      customer_id: null,
      order_id: null,
    };

    const res = await runAction(payload);
    expect(res.status).toBe(200);
    expect(sendWhatsAppMock).not.toHaveBeenCalled();
    expect(smsLogCreateMock).not.toHaveBeenCalled();
  });
});