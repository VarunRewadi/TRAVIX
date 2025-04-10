import { createClient } from '@supabase/supabase-js';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import axios from 'axios';

dotenv.config();

const app = express();
const PORT = 3000;

// Initialize Supabase Client
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

// Calculate __dirname manually
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);  // Equivalent to __dirname

app.set('views', path.join(__dirname, 'views')); // Adjust path as needed
app.set('view engine', 'ejs');
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Middleware to check user session
app.use(async (req, res, next) => {
    const { data: session, error } = await supabase.auth.getSession();
  
    if (error) {
      console.error('Error getting session:', error);
    }
  
    res.locals.user = session?.user || null; // Store user session for EJS
    next();
  });


// **Sign Up Page**
app.get("/register", (req, res) => {
    res.render("register", { title: "Sign Up - Travix" });
});
  
// **Login Page**
app.get("/login", (req, res) => {
    res.render("login", { title: "Login - Travix" });
});
  
// **Sign Up Route**
app.post("/register", async (req, res) => {
  const { email, password } = req.body;
  const { data, error } = await supabase.auth.signUp({ email, password });

  if (error) {
    return res.send(`Error: ${error.message}`);
  }
  
  res.redirect("/"); // Redirect to home page after successful sign-up
});

// **Login Route**
app.post("/login", async (req, res) => {
  const { email, password } = req.body;
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    return res.send(`Error: ${error.message}`);
  }
  
  res.redirect("/"); // Redirect to home page after successful login
});

// **Google Authentication**
app.get("/auth/google", async (req, res) => {
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: `${process.env.BASE_URL}/auth/callback` },
  });

  if (error) {
    return res.send(`Error: ${error.message}`);
  }

  res.redirect(data.url); // Redirect to Google Auth
});

// **Google Auth Callback**
app.get("/auth/callback", async (req, res) => {
  const { user, session, error } = await supabase.auth.getUser(req.query.access_token);

  if (error) {
    return res.send(`Error: ${error.message}`);
  }

  res.redirect("/"); // Redirect to home page after successful authentication
});

// **Logout Route**
app.get("/logout", async (req, res) => {
  const { error } = await supabase.auth.signOut();
  
  if (error) {
    return res.send(`Error: ${error.message}`);
  }

  res.redirect("/"); // Redirect to home page after logout
});

// Amadeus Authentication
let accessToken = '';

// Function to authenticate with Amadeus API
async function authenticateAmadeus() {
    const authUrl = 'https://test.api.amadeus.com/v1/security/oauth2/token';
    try {
        const response = await axios.post(authUrl, new URLSearchParams({
            grant_type: 'client_credentials',
            client_id: process.env.AMADEUS_CLIENT_ID,
            client_secret: process.env.AMADEUS_CLIENT_SECRET
        }).toString(), {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });
        accessToken = response.data.access_token;
    } catch (error) {
        console.error('Error authenticating with Amadeus:', error.message);
    }
}

// Middleware to ensure Amadeus is authenticated
app.use(async (req, res, next) => {
    if (!accessToken) {
        await authenticateAmadeus();
    }
    next();
});

// **Landing Page**
app.get("/", (req, res) => {
  res.render("index", { title: "Travix - Travel Booking" });
});

// Explore 
app.get('/explore', (req, res) => {
    res.render('explore', { title: 'Search Explore', query: req.query });
});



app.get('/flights', (req, res) => {
    res.render('flights', { title: 'Search Flights', query: req.query });
});

app.get('/place-order', (req, res) => {
    res.render('place-order', { title: 'Place Order', query: req.query });
});

app.get('/order-success', (req, res) => {
    res.render('order-success', { title: 'Order Successful', query: req.query });
});

app.get('/suggestions', async (req, res) => {
    const query = req.query.query;

    try {
        const response = await axios.get('https://test.api.amadeus.com/v1/reference-data/locations', {
            headers: {
                Authorization: `Bearer ${accessToken}`
            },
            params: {
                keyword: query,
                subType: 'AIRPORT,CITY'
            }
        });

        // Map response to include both city and airport name
        const suggestions = response.data.data.map(item => ({
            city: item.address.cityName,
            airport: item.name,
            code: item.iataCode
        }));

        res.json(suggestions);
    } catch (error) {
        console.error('Error fetching suggestions:', error.message);
        res.status(500).send('Error fetching suggestions');
    }
});


// Function to get airline names by their codes using Amadeus API
async function getAirlinesFromFlightOffers(flights) {
    const uniqueCarrierCodes = [...new Set(flights.map(flight => flight.itineraries[0].segments[0].carrierCode))];
    const airlines = [];

    for (const code of uniqueCarrierCodes) {
        try {
            const response = await axios.get(`https://test.api.amadeus.com/v1/reference-data/airlines`, {
                headers: {
                    Authorization: `Bearer ${accessToken}`
                },
                params: {
                    airlineCodes: code
                }
            });

            const airlineData = response.data.data[0]; // Get the first result
            airlines.push({
                code: airlineData.iataCode,
                name: airlineData.commonName || airlineData.officialName
            });
        } catch (error) {
            console.error(`Error fetching airline with code ${code}:`, error.response ? error.response.data : error.message);
        }
    }

    return airlines;
}

app.get('/flight-offers', async (req, res) => {
    const { originCode, destinationCode, departureDate } = req.query;
    const flightUrl = `https://test.api.amadeus.com/v2/shopping/flight-offers`;

    try {
        const response = await axios.get(flightUrl, {
            headers: {
                Authorization: `Bearer ${accessToken}`
            },
            params: {
                originLocationCode: originCode,
                destinationLocationCode: destinationCode,
                departureDate,
                adults: 1
            }
        });

        const originCity = await getCityNameFromIATA(originCode);
        const destinationCity = await getCityNameFromIATA(destinationCode);
        const flightData = response.data;

        const destinationCodes = await getRelatedAirportCodes(destinationCode);

        const filteredFlights = flightData.data.filter(flight => {
            const departureCode = flight.itineraries[0].segments[0].departure.iataCode;
            const arrivalCode = flight.itineraries[0].segments[0].arrival.iataCode;
            return departureCode === originCode && destinationCodes.includes(arrivalCode);
        });

        // Fetch airline names for the flights
        const airlines = await getAirlinesFromFlightOffers(filteredFlights);

        res.render('flight-offers', { 
            title: 'Flight Offers', 
            flights: filteredFlights, 
            originCode, 
            destinationCode,
            originCity,
            destinationCity,
            airlines, // Dynamically fetched airlines
            query: req.query
        });
        console.log(response.data)
    } catch (error) {
        console.error('Error fetching flight offers:', error.response ? error.response.data : error.message);
        res.status(500).send('Error fetching flight offers');
    }
});

// Helper function to fetch city name from IATA code
async function getCityNameFromIATA(iataCode) {
    const url = `https://test.api.amadeus.com/v1/reference-data/locations`;
    try {
        const response = await axios.get(url, {
            headers: {
                Authorization: `Bearer ${accessToken}`
            },
            params: {
                keyword: iataCode,
                subType: 'AIRPORT,CITY'
            }
        });

        // Extract city name from the first matching result
        if (response.data && response.data.data.length > 0) {
            return response.data.data[0].address.cityName || iataCode;
        } else {
            return iataCode;
        }
    } catch (error) {
        console.error(`Error fetching city name for IATA code ${iataCode}:`, error.message);
        return iataCode; // Fallback to IATA code if there's an error
    }
}

// Function to get all related airport codes for a city (e.g., JFK, LGA, EWR for New York)
async function getRelatedAirportCodes(cityCode) {
    try {
        const response = await axios.get('https://test.api.amadeus.com/v1/reference-data/locations', {
            headers: { Authorization: `Bearer ${accessToken}` },
            params: { keyword: cityCode, subType: 'AIRPORT' }
        });

        return response.data.data.map(airport => airport.iataCode);
    } catch (error) {
        console.error('Error fetching related airport codes:', error.message);
        return [cityCode]; // Fallback to the city code if the API fails
    }
}

// Helper function to fetch city and airport names
async function getCityAndAirportName(iataCode) {
    try {
        const response = await axios.get('https://test.api.amadeus.com/v1/reference-data/locations', {
            headers: { Authorization: `Bearer ${accessToken}` },
            params: { keyword: iataCode, subType: 'AIRPORT,CITY' }
        });

        const location = response.data.data[0];
        return {
            city: location.address.cityName || iataCode,
            airport: location.name || 'Unknown Airport'
        };
    } catch (error) {
        console.error(`Error fetching city and airport name for ${iataCode}:`, error.message);
        return { city: iataCode, airport: 'Unknown Airport' };
    }
}


app.get('/flight-details', async (req, res) => {
    const offerId = req.query.offerId; // Extract the offer ID from the query parameters
    const flightPricingUrl = `https://test.api.amadeus.com/v1/shopping/flight-offers/pricing`;

    if (!offerId) {
        return res.status(400).send('Flight offer ID is required'); // Check if offerId is present
    }

    try {
        // Fetch the specific flight offer using the ID
        const flightOfferResponse = await axios.get('https://test.api.amadeus.com/v2/shopping/flight-offers', {
            headers: { Authorization: `Bearer ${accessToken}` },
            params: {
                originLocationCode: req.query.originCode,
                destinationLocationCode: req.query.destinationCode,
                departureDate: req.query.departureDate,
                adults: 1
            }
        });

        // Find the flight offer matching the provided ID
        const flightOffer = flightOfferResponse.data.data.find(offer => offer.id === offerId);

        if (!flightOffer) {
            return res.status(404).send('Flight offer not found');
        }

        // Use the flight offer in the flight pricing API
        const flightDetailsResponse = await axios.post(flightPricingUrl, {
            data: { type: 'flight-offers-pricing', flightOffers: [flightOffer] } // Include the flight offer for pricing
        }, {
            headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }
        });

        const flightDetails = flightDetailsResponse.data;

        // Fetch airline names
        const airlines = await getAirlinesFromFlightOffers([flightOffer]);

        // Fetch additional information like city names, airport names, terminals, and detailed pricing (including tax)
        for (let itinerary of flightDetails.data.flightOffers[0].itineraries) {
            for (let segment of itinerary.segments) {
                const departureLocation = await getCityAndAirportName(segment.departure.iataCode);
                const arrivalLocation = await getCityAndAirportName(segment.arrival.iataCode);

                segment.departure.cityName = departureLocation.city;
                segment.departure.airportName = departureLocation.airport;
                segment.departure.terminal = segment.departure.terminal || 'N/A'; // Handle cases where terminal info is not available
                segment.arrival.cityName = arrivalLocation.city;
                segment.arrival.airportName = arrivalLocation.airport;
                segment.arrival.terminal = segment.arrival.terminal || 'N/A';

                // Match carrierCode with airline name
                const airline = airlines.find(a => a.code === segment.carrierCode);
                segment.airlineName = airline ? airline.name : segment.carrierCode;

                // Calculate and format flight duration
                const departureTime = new Date(segment.departure.at);
                const arrivalTime = new Date(segment.arrival.at);
                const duration = Math.floor((arrivalTime - departureTime) / (1000 * 60)); // Duration in minutes
                const hours = Math.floor(duration / 60);
                const minutes = duration % 60;
                segment.flightDuration = `${hours}h ${minutes}m`; // Display duration as "Xh Ym"
            }
        }

        // Get detailed pricing, including taxes
        const totalPrice = flightDetails.data.flightOffers[0].price.total;
        const totalTax = flightDetails.data.flightOffers[0].price.totalTaxes || 'N/A';

        // Render the flight details page with all the required information
        res.render('flight-details', {
            title: 'Flight Details',
            flight: flightDetails.data.flightOffers[0],
            totalPrice: totalPrice, // Include total price with tax
            totalTax: totalTax,     // Include tax details
        });

    } catch (error) {
        console.error('Error fetching flight details:', error.message);
        res.status(500).send('Error fetching flight details');
    }
});


app.post('/confirm-booking', async (req, res) => {
    const { travelerName, travelerEmail, travelerPhone, travelerDOB, travelerGender, offerId, originCode, destinationCode, departureDate } = req.body;

    // Check for required fields
    if (!travelerName || !travelerEmail || !travelerPhone || !travelerDOB || !travelerGender || !offerId || !originCode || !destinationCode || !departureDate) {
        console.error('Missing required fields', req.body);
        return res.status(400).json({ error: 'Missing required fields' });
    }

    try {
        // Fetch the flight offer using the offerId
        console.log('Fetching flight offers with the following parameters:', {
            originLocationCode: originCode,
            destinationLocationCode: destinationCode,
            departureDate: departureDate,
        });

        const flightOffersResponse = await axios.get('https://test.api.amadeus.com/v2/shopping/flight-offers', {
            headers: { Authorization: `Bearer ${accessToken}` },
            params: {
                originLocationCode: originCode,
                destinationLocationCode: destinationCode,
                departureDate: departureDate,
                adults: 1
            }
        });

        console.log('Flight offers response:', flightOffersResponse.data);

        const flightOffer = flightOffersResponse.data.data.find(offer => offer.id === offerId);
        if (!flightOffer) {
            console.error('Flight offer not found for offerId:', offerId);
            return res.status(404).json({ error: 'Flight offer not found' });
        }

        // Create the booking payload
        const bookingPayload = {
            data: {
                type: 'flight-order',
                flightOffers: [flightOffer],
                travelers: [{
                    id: '1',  // Unique ID for each traveler
                    dateOfBirth: travelerDOB,
                    name: {
                        firstName: travelerName.split(' ')[0],
                        lastName: travelerName.split(' ')[1] || ''
                    },
                    gender: travelerGender.toUpperCase(),  // Ensure gender is uppercase
                    contact: {
                        emailAddress: travelerEmail,
                        phones: [{ deviceType: 'MOBILE', countryCallingCode: '91', number: travelerPhone }]
                    }
                }]
            }
        };

        // Log the booking payload for debugging
        console.log('Booking payload:', bookingPayload);

        // Create the booking using the Amadeus API
        const bookingResponse = await axios.post('https://test.api.amadeus.com/v1/booking/flight-orders', bookingPayload, {
            headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }
        });

        console.log('Booking response:', bookingResponse.data);

        const bookingData = bookingResponse.data;

        if (!bookingData || !bookingData.data || !bookingData.data.id) {
            console.error('Booking response was not successful:', bookingData);
            return res.status(500).json({ error: 'Booking was not successful' });
        }

        const bookingId = bookingData.data.id;
        console.log(bookingId);
        
        const redirectUrl = `/booked-flight?name=${encodeURIComponent(travelerName)}&email=${encodeURIComponent(travelerEmail)}&phone=${encodeURIComponent(travelerPhone)}&dob=${encodeURIComponent(travelerDOB)}&gender=${encodeURIComponent(travelerGender)}&bookingId=${encodeURIComponent(bookingId)}`;

        res.json({ redirect: redirectUrl });
    } catch (error) {
        // Enhanced error handling
        console.error('Error confirming booking:', error.response?.data || error.message);
        res.status(500).json({ error: 'Error confirming booking' });
    }
});

app.get('/booked-flight', async (req, res) => {
    const { name, email, phone, dob, gender, bookingId } = req.query;

    if (!bookingId) {
        return res.status(400).json({ error: 'Missing booking ID' });
    }

    try {
        const bookingDetailsResponse = await axios.get(`https://test.api.amadeus.com/v1/booking/flight-orders/${bookingId}`, {
            headers: {
                Authorization: `Bearer ${accessToken}`
            }
        });

        const bookingDetails = bookingDetailsResponse.data;
        const segments = [];
        const flightOffers = bookingDetails.data.flightOffers;

        if (flightOffers && Array.isArray(flightOffers)) {
            for (const offer of flightOffers) {
                if (offer.itineraries && Array.isArray(offer.itineraries)) {
                    for (const itinerary of offer.itineraries) {
                        if (itinerary.segments && Array.isArray(itinerary.segments)) {
                            for (const segment of itinerary.segments) {
                                const departureIata = segment.departure.iataCode;
                                const arrivalIata = segment.arrival.iataCode;

                                const [departureInfo, arrivalInfo] = await Promise.all([
                                    getCityAndAirportName(departureIata),
                                    getCityAndAirportName(arrivalIata)
                                ]);

                                segments.push({
                                    ...segment,
                                    departure: {
                                        cityName: departureInfo.city,
                                        airportName: departureInfo.airport,
                                        iataCode: departureIata,
                                        at: segment.departure.at
                                    },
                                    arrival: {
                                        cityName: arrivalInfo.city,
                                        airportName: arrivalInfo.airport,
                                        iataCode: arrivalIata,
                                        at: segment.arrival.at
                                    }
                                });
                            }
                        }
                    }
                }
            }
        }

        res.render('booked-flight', { 
            title: 'Booking Confirmation',
            travelerInfo: { name, email, phone, dob, gender },
            bookingDetails: { ...bookingDetails, segments }
        });
    } catch (error) {
        console.log('Error fetching booking details:', error.message);
        res.status(500).json({ error: 'Error fetching booking details' });
    }
});

// Hotels Route (New)
app.get('/hotels', (req, res) => {
    
        res.render('hotels', { title: 'Search Hotels', query: req.query });

    
});

// Autocomplete Suggestions Route (for city names)
app.get('/hotel-suggestions', async (req, res) => {
    const query = req.query.query;

    try {
        let citySuggestions = [];

        if (query.length >= 3) {

            // Fetch city suggestions
            const cityResponse = await axios.get('https://test.api.amadeus.com/v1/reference-data/locations', {
                headers: {
                    Authorization: `Bearer ${accessToken}`
                },
                params: {
                    keyword: query,
                    subType: 'CITY'
                }
            });
            citySuggestions = cityResponse.data.data.map(item => ({
                name: item.name,
                code: item.iataCode
            }));
        }

        res.json(citySuggestions);
    } catch (error) {
        console.error('Error fetching suggestions:', error.message);
        res.status(500).send('Error fetching suggestions');
    }
});


// Route for fetching hotel offers by city
app.get('/hotel-offers', async (req, res) => {
    const { searchQuery, checkInDate, checkOutDate, adults } = req.query;

    console.log('Hotel search query:', searchQuery);
    console.log('Check-in date:', checkInDate);
    console.log('Check-out date:', checkOutDate);

    if (!checkInDate || !checkOutDate || !searchQuery) {
        console.log('Missing required parameters.');
        return res.status(400).send('Check-in and check-out dates, and a city name are required.');
    }

    try {
        // Fetch the city IATA code using the Amadeus Locations API
        const cityResponse = await axios.get('https://test.api.amadeus.com/v1/reference-data/locations', {
            headers: {
                Authorization: `Bearer ${accessToken}`
            },
            params: {
                keyword: searchQuery,
                subType: 'CITY'
            }
        });

        // Ensure city data is returned and exists
        const cityData = cityResponse.data.data[0];
        if (!cityData || !cityData.iataCode) {
            return res.status(404).send('City not found.');
        }

        const cityCode = cityData.iataCode;
        console.log('Fetched city code:', cityCode);

        // Call Amadeus "Hotel Offers by City" API
        const hotelUrl = `https://test.api.amadeus.com/v1/reference-data/locations/hotels/by-city?cityCode=${cityCode}`;

        console.log('Fetching hotels for city code:', cityCode);
        console.log(hotelUrl);

        const offersResponse = await axios.get(hotelUrl, {
            headers: { Authorization: `Bearer ${accessToken}` }
        });

        
        // console.log('Hotels response:', offersResponse.data);

        // Ensure the API returned hotel data
        if (!offersResponse.data.data || offersResponse.data.data.length === 0) {
            return res.status(404).send('No hotels found for the provided city.');
        }

        // Render the hotel-offers.ejs template with the hotel data
        return res.render('hotel-offers', {
            title: 'Hotel Offers',
            hotels: offersResponse.data.data,
            query: req.query // Pass the original query for possible use in the view
        });
    } catch (error) {
        console.error('Error fetching hotels:', error.response ? error.response.data : error.message);
        if (error.response && error.response.status === 400) {
            return res.status(400).send('Bad request: please check your parameters.');
        }
        return res.status(500).send('Error fetching hotels.');
    }
});

app.get('/hotel-details', async (req, res) => {
    const offerId = req.query.hotelId; // Ensure this matches the button's parameter
    console.log(offerId);
    // if (!offerId) {
    //     return res.status(400).send('Hotel offer ID is required');
    // }

    try {
        // Fetch the specific hotel offer details
        const hotelOfferResponse = await axios.get(`https://test.api.amadeus.com/v3/shopping/hotel-offers?hotelIds=${offerId}`, {
            headers: { Authorization: `Bearer ${accessToken}` } // Ensure this is correct
        });

        const hotelOffer = hotelOfferResponse.data.data[0];
        console.log(hotelOffer);
        
        if (!hotelOffer) {
            return res.status(404).send('Hotel offer not found');
        }

        // Prepare the hotel data for display on the `hotel-details` page
        const hotelInfo = {
            id: hotelOffer.hotel.hotelId,
            name: hotelOffer.hotel.name,
            description: hotelOffer.hotel.description || "No description available",
            address: hotelOffer.hotel.address,
            rating: hotelOffer.hotel.rating || 'N/A',
            offers: hotelOffer.offers.map(offer => ({
                checkInDate: offer.checkInDate,
                checkOutDate: offer.checkOutDate,
                currency: offer.price.currency,
                price: offer.price.total,
                room: {
                    id: offer.room.id,
                    description: offer.room.description.text,
                    type: offer.room.type,
                    category: offer.room.typeEstimated.category,
                    beds: offer.room.typeEstimated.beds,
                    bedType: offer.room.typeEstimated.bedType
                }
            }))
        };
        

        res.render('hotel-details', {
            title: 'Hotel Details',
            hotel: hotelInfo
        });
    } catch (error) {
        console.error('Error fetching hotel details:', error.message);
        res.status(500).send('Error fetching hotel details');
    }
});




app.get('/booked-hotel', async (req, res) => {
    const { name, email, phone, dob, gender, bookingId } = req.query;

    if (!bookingId) {
        return res.status(400).json({ error: 'Missing booking ID' });
    }

    try {
        const bookingDetailsResponse = await axios.get(`https://test.api.amadeus.com/v1/booking/hotel-bookings/${bookingId}`, {
            headers: { Authorization: `Bearer ${accessToken}` }
        });

        const bookingDetails = bookingDetailsResponse.data;

        res.render('booked-hotel', { 
            title: 'Hotel Booking Confirmation',
            travelerInfo: { name, email, phone, dob, gender },
            bookingDetails
        });
    } catch (error) {
        console.log('Error fetching booking details:', error.message);
        res.status(500).json({ error: 'Error fetching booking details' });
    }
});


// Cars Route (New)
app.get('/cars', (req, res) => {
    
        res.render('cars', { title: 'Search Cars', query: req.query });

    
});



// Start the server
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
