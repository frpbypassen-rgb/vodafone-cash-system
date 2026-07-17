const { getApiReferenceNumber } = require('../services/externalApiService');

describe('externalApiService reference detection', () => {
    test('extracts nested API reference numbers', () => {
        const apiResult = {
            raw_response: {
                Data: {
                    TransactionNumber: '5002587',
                    RefTransactionNumber: '5002587'
                }
            }
        };

        expect(getApiReferenceNumber(apiResult)).toBe('5002587');
    });

    test('extracts reference number from API process log text', () => {
        const processLog = `
[ التفاصيل المالية والتشغيلية للعملية ]
- رقم العملية    : 5002587
- الرقم المرجعي  : 5002587
`;

        expect(getApiReferenceNumber({ processLog })).toBe('5002587');
    });

    test('does not treat transaction number alone as a reference', () => {
        const apiResult = {
            success: 'pending',
            external_transaction_id: '5002587'
        };

        expect(getApiReferenceNumber(apiResult)).toBe('');
    });
});
