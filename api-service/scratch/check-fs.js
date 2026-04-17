const fs = require('fs');
console.log('fs.promises type:', typeof fs.promises);
console.log('fs.promiseskeys:', Object.keys(fs.promises || {}));
