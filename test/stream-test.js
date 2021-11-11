const fs = require('fs');
const Transform = require('stream').Transform;

const parser = new Transform();
parser._transform = (chunk, encoding, callback) => {
    const str = chunk.toString();
    const error = null; // new Error('test');

    console.log('\n--- CHUNK ---\n', str, '\n', error);

    callback(error, str);
};

console.log('\n--- BEGIN STREAM ---');

// Create and Transform Stream
let stream = fs.createReadStream('../../../build/index.html'); // Create
stream = stream.pipe(parser); // Transform
stream = stream.on('end', () => console.log('\n--- END STREAM ---')); // Runs after all data is read

// Read Stream
streamToString(stream).then(str => console.log('\n--- FULL DATA ---\n', str)).catch(e => e);



function streamToString(stream) {
    const chunks = [];
    return new Promise((res, rej) => {
        if (!stream?.on) return res(stream);
        stream.on('data', chunk => chunks.push(Buffer.from(chunk)));
        stream.on('error', err => rej(err));
        stream.on('end', () => res(Buffer.concat(chunks).toString('utf8')));
    });
}