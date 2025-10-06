const express = require('express');
const fetch = require('node-fetch');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// Use CORS middleware to allow requests from any origin
app.use(cors());

// Define the API endpoint
app.get('/api/pets', async (req, res) => {
  const starPetsApiUrl = 'https://starpets.pw/api/v2/market/inventory/?limit=250&offset=0&orderBy=price&order=asc&game=adp';
  
  try {
    const apiResponse = await fetch(starPetsApiUrl, {
      headers: {
        'Accept': 'application/json',
        // It's good practice to mimic a real browser user-agent
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    });

    if (!apiResponse.ok) {
      // If the API returns a non-200 status, forward the error
      return res.status(apiResponse.status).json({ message: 'Error fetching from StarPets API' });
    }

    const data = await apiResponse.json();
    res.json(data);

  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({ message: 'Internal Server Error' });
  }
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

