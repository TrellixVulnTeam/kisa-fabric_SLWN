/**
 * 목적:
 * 서버 실행에 필요한 환경정보를 담고있는 config.json 파일을 읽어 들인다.
 *
 * @author 최의신 (choies@kr.ibm.com)
 *
 */
var fs = require('fs');

var config;

try {
    config = JSON.parse(fs.readFileSync('./config.json', 'utf8'));
} catch (err) {
    console.log("config.json 파일을 읽을 수 없습니다. 프로그램을 종료합니다. " + err);
    process.exit();
}

module.exports = config;
