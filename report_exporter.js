// Sử dụng dotenv để tải biến môi trường từ tệp .env khi phát triển cục bộ
// Trên Railway, các biến này sẽ được thiết lập trong dashboard
require('dotenv').config();

const jwt = require('jsonwebtoken');
const axios = require('axios');
const { google } = require('googleapis');

// === CẤU HÌNH ===
console.log("Đang đọc biến môi trường từ Railway...");
console.log("APPLE_CLIENT_ID:", process.env.APPLE_CLIENT_ID ? "Có giá trị" : "Thiếu hoặc rỗng");
console.log("APPLE_TEAM_ID:", process.env.APPLE_TEAM_ID ? "Có giá trị" : "Thiếu hoặc rỗng");
console.log("APPLE_KEY_ID:", process.env.APPLE_KEY_ID ? "Có giá trị" : "Thiếu hoặc rỗng");
console.log("APPLE_PRIVATE_KEY (trước khi xử lý):", process.env.APPLE_PRIVATE_KEY ? "Có giá trị" : "Thiếu hoặc rỗng");
// Đọc từ biến môi trường
const APPLE_CLIENT_ID = process.env.APPLE_CLIENT_ID;
const APPLE_TEAM_ID = process.env.APPLE_TEAM_ID; // Organization ID cho API v4
const APPLE_KEY_ID = process.env.APPLE_KEY_ID;
// Khóa riêng tư cần được định dạng đúng trong biến môi trường (thay thế newline bằng \n)
const APPLE_PRIVATE_KEY = process.env.APPLE_PRIVATE_KEY?.replace(/\\n/g, '\n');

const GOOGLE_SPREADSHEET_ID = process.env.GOOGLE_SPREADSHEET_ID;
const GOOGLE_SHEET_NAME = process.env.GOOGLE_SHEET_NAME || 'AppleSearchAds_Report';
// Thông tin xác thực tài khoản dịch vụ Google (chuỗi JSON)
const GOOGLE_SERVICE_ACCOUNT_CREDENTIALS = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS || '{}');

// Tham số báo cáo (có thể tùy chỉnh thêm)
const REPORT_PAYLOAD = {
    startTime: process.env.REPORT_START_TIME || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0] + "T00:00:00Z", // Mặc định 7 ngày trước
    endTime: process.env.REPORT_END_TIME || new Date().toISOString().split('T')[0] + "T23:59:59Z", // Mặc định hôm nay
    selector: {
        orderBy: [{ field: "campaignId", sortOrder: "ASCENDING" }],
        // pagination: { offset: 0, limit: 1000 } // Bỏ comment nếu cần phân trang
    },
    granularity: process.env.REPORT_GRANULARITY || "DAILY",
    // returnRowTotals: true,
    // returnGrandTotals: true
};

// === HÀM HỖ TRỢ ===

/**
 * Tạo JSON Web Token (JWT) để xác thực với Apple Search Ads API.
 */
function generateAppleApiToken() {
    console.log('Đang tạo Apple API token...');
    if (!APPLE_CLIENT_ID || !APPLE_TEAM_ID || !APPLE_KEY_ID || !APPLE_PRIVATE_KEY) {
        console.error('Thiếu thông tin cấu hình của Apple (CLIENT_ID, TEAM_ID, KEY_ID, PRIVATE_KEY).');
        throw new Error('Thiếu thông tin cấu hình của Apple.');
    }
    const payload = {
        iss: APPLE_TEAM_ID,    // Issuer (Team ID) - Trong docs mới là Apple Developer Team ID
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + (20 * 60), // Thời hạn 20 phút
        aud: 'https://appleid.apple.com',
        sub: APPLE_CLIENT_ID   // Subject (Client ID)
    };
    const options = {
        algorithm: 'ES256',
        header: {
            alg: 'ES256',
            kid: APPLE_KEY_ID
        }
    };
    try {
        const token = jwt.sign(payload, APPLE_PRIVATE_KEY, options);
        console.log('Đã tạo Apple API token thành công.');
        return token;
    } catch (error) {
        console.error('Lỗi khi tạo Apple JWT:', error.message);
        if (error.message.includes('PEM_read_bio_PrivateKey')) {
            console.error('Định dạng private key có thể không đúng. Hãy đảm bảo nó bắt đầu bằng -----BEGIN PRIVATE KEY----- và kết thúc bằng -----END PRIVATE KEY-----, và các ký tự xuống dòng được thay thế bằng \\n trong biến môi trường.');
        }
        throw error;
    }
}

/**
 * Gọi API Apple Search Ads để lấy dữ liệu báo cáo chiến dịch.
 * @param {string} authToken - JWT đã tạo.
 * @param {object} payload - Đối tượng payload cho yêu cầu báo cáo.
 */
async function fetchAppleSearchAdsReport(authToken, payload) {
    const apiUrl = 'https://api.searchads.apple.com/api/v4/reports/campaigns';
    console.log(`Đang lấy báo cáo từ Apple Search Ads... Từ ${payload.startTime} đến ${payload.endTime}`);

    const headers = {
        'Authorization': `Bearer ${authToken}`,
        'X-Apple-Cloud- Verwaltungs-Team-ID': APPLE_TEAM_ID, // Hoặc 'orgId' nếu API yêu cầu, kiểm tra docs
        'Content-Type': 'application/json'
    };

    try {
        const response = await axios.post(apiUrl, payload, { headers });
        console.log('Đã nhận phản hồi từ Apple Search Ads API.');
        if (response.data && response.data.data && response.data.data.reportingDataResponse && response.data.data.reportingDataResponse.row) {
            return response.data.data.reportingDataResponse.row;
        } else if (response.data && response.data.data && response.data.data.reportingDataResponse && response.data.data.reportingDataResponse.row === null) {
            console.log('API trả về không có dòng dữ liệu nào (row is null).');
            return []; // Trả về mảng rỗng nếu không có dữ liệu
        }
        else {
            console.warn('Phản hồi từ API không có cấu trúc dữ liệu báo cáo mong đợi.');
            console.warn('Chi tiết phản hồi:', JSON.stringify(response.data, null, 2));
            return [];
        }
    } catch (error) {
        console.error('Lỗi khi gọi API Apple Search Ads:');
        if (error.response) {
            console.error('Data:', JSON.stringify(error.response.data, null, 2));
            console.error('Status:', error.response.status);
            console.error('Headers:', error.response.headers);
        } else if (error.request) {
            console.error('Request:', error.request);
        } else {
            console.error('Error message:', error.message);
        }
        throw error;
    }
}

/**
 * Ghi dữ liệu vào Google Sheet.
 * @param {Array<Object>} data - Mảng đối tượng dữ liệu báo cáo.
 */
async function writeToGoogleSheet(data) {
    console.log(`Đang chuẩn bị ghi ${data.length} dòng vào Google Sheet...`);
    if (!GOOGLE_SPREADSHEET_ID || !GOOGLE_SHEET_NAME || !GOOGLE_SERVICE_ACCOUNT_CREDENTIALS.client_email) {
        console.error('Thiếu thông tin cấu hình Google Sheets (SPREADSHEET_ID, SHEET_NAME, SERVICE_ACCOUNT_CREDENTIALS).');
        throw new Error('Thiếu thông tin cấu hình Google Sheets.');
    }

    const auth = new google.auth.GoogleAuth({
        credentials: GOOGLE_SERVICE_ACCOUNT_CREDENTIALS,
        scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });
    const sheets = google.sheets({ version: 'v4', auth });

    // Xóa dữ liệu cũ trong sheet
    try {
        console.log(`Đang xóa dữ liệu cũ trong sheet: ${GOOGLE_SHEET_NAME}`);
        await sheets.spreadsheets.values.clear({
            spreadsheetId: GOOGLE_SPREADSHEET_ID,
            range: GOOGLE_SHEET_NAME,
        });
    } catch (error) {
        console.error('Lỗi khi xóa dữ liệu cũ trong sheet:', error.message);
        // Không dừng lại nếu không xóa được, có thể sheet chưa tồn tại hoặc rỗng
    }

    if (!data || data.length === 0) {
        console.log('Không có dữ liệu để ghi vào sheet.');
        await sheets.spreadsheets.values.update({
            spreadsheetId: GOOGLE_SPREADSHEET_ID,
            range: `${GOOGLE_SHEET_NAME}!A1`,
            valueInputOption: 'USER_ENTERED',
            resource: {
                values: [['Không có dữ liệu báo cáo cho khoảng thời gian đã chọn.']],
            },
        });
        return;
    }

    // Chuẩn bị headers và rows
    const headers = [];
    const firstRowData = data[0];

    if (firstRowData.metadata) {
        Object.keys(firstRowData.metadata).forEach(key => headers.push(`metadata.${key}`));
    }
    if (firstRowData.granularity && firstRowData.granularity[0]) {
        Object.keys(firstRowData.granularity[0]).forEach(key => headers.push(`metric.${key}`));
    }

    const rows = data.map(row => {
        const rowValues = [];
        headers.forEach(header => {
            const [source, key] = header.split('.');
            if (source === 'metadata' && row.metadata) {
                rowValues.push(row.metadata[key] !== undefined ? row.metadata[key] : '');
            } else if (source === 'metric' && row.granularity && row.granularity[0]) {
                rowValues.push(row.granularity[0][key] !== undefined ? row.granularity[0][key] : '');
            } else {
                rowValues.push('');
            }
        });
        return rowValues;
    });

    const valuesToUpdate = [headers, ...rows];

    try {
        console.log(`Đang ghi dữ liệu vào sheet: ${GOOGLE_SHEET_NAME}`);
        await sheets.spreadsheets.values.update({
            spreadsheetId: GOOGLE_SPREADSHEET_ID,
            range: `${GOOGLE_SHEET_NAME}!A1`, // Bắt đầu từ ô A1
            valueInputOption: 'USER_ENTERED', // Hoặc 'RAW' nếu bạn muốn nhập liệu thô
            resource: {
                values: valuesToUpdate,
            },
        });
        console.log('Đã ghi dữ liệu vào Google Sheet thành công!');
    } catch (error) {
        console.error('Lỗi khi ghi dữ liệu vào Google Sheet:', error.message);
        if (error.errors) console.error('Chi tiết lỗi Google API:', JSON.stringify(error.errors, null, 2));
        throw error;
    }
}

// === HÀM CHÍNH THỰC THI ===
async function main() {
    console.log('Bắt đầu quá trình xuất báo cáo Apple Search Ads...');
    try {
        const appleToken = generateAppleApiToken();
        const reportData = await fetchAppleSearchAdsReport(appleToken, REPORT_PAYLOAD);

        if (reportData && reportData.length > 0) {
            await writeToGoogleSheet(reportData);
        } else {
            console.log('Không có dữ liệu báo cáo để ghi. Kiểm tra lại khoảng thời gian hoặc cấu hình báo cáo.');
            // Ghi một thông báo vào sheet nếu không có dữ liệu
            await writeToGoogleSheet([]);
        }
        console.log('Hoàn tất quá trình xuất báo cáo.');
    } catch (error) {
        console.error('Đã xảy ra lỗi trong quá trình chính:', error.message);
        process.exit(1); // Thoát với mã lỗi
    }
}

// Chạy hàm main
main();
