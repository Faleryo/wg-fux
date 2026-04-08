const crypto = require('crypto');
const util = require('util');
const pbkdf2Async = util.promisify(crypto.pbkdf2);

async function test() {
  const password = 'admin'; // Or admin123
  const salt = 'c8641ce529fa7509570c9b7633534872';
  const expectedHash =
    '54d8eaaaed6b466877e58f69e81b3b2cf99c23c32dbb04f449a5d013f0de952aa7d411bfbefcd021fb79153a1a3f46ddabe6951178f78c71e16c3515079f565d';

  const iterations = 600000;
  const hashBuffer = await pbkdf2Async(password, salt, iterations, 64, 'sha512');
  const generatedHash = hashBuffer.toString('hex');

  console.log(`Generated: ${generatedHash}`);
  console.log(`Expected:  ${expectedHash}`);
  console.log(`Match: ${generatedHash === expectedHash}`);

  const password123 = 'admin123';
  const hashBuffer123 = await pbkdf2Async(password123, salt, iterations, 64, 'sha512');
  const generatedHash123 = hashBuffer123.toString('hex');
  console.log(`admin123 Match: ${generatedHash123 === expectedHash}`);
}

test();
