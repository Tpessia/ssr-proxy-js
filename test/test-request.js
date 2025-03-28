const axios = require('axios');

axios.get('http://localhost:3000/login')
    .then(r => r.data)
    .catch(err => err.response ? err.response.data : err.toString())
    .then(console.log);