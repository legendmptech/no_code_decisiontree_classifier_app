# No Code Decision Tree Classifier App

This project is a simple Node.js application that serves a frontend displaying a list of text titles retrieved from an API. The titles are stored in an array on the backend without the use of a database.

## Project Structure

```
no_code_decisiontree_classifier_app
├── src
│   ├── server.js        # Entry point of the application, sets up the Express server
│   └── titles.js        # Exports an array of text titles
├── public
│   ├── index.html       # Main HTML file for the frontend
│   └── main.js          # Frontend JavaScript code to fetch and display titles
├── package.json         # Configuration file for npm
└── README.md            # Documentation for the project
```

## Installation

1. Clone the repository:
   ```
   git clone <repository-url>
   ```

2. Navigate to the project directory:
   ```
   cd no_code_decisiontree_classifier_app
   ```

3. Install the dependencies:
   ```
   npm install
   ```

## Usage

To start the server, run the following command:
```
node src/server.js
```

The server will be running on `http://localhost:3000`. Open this URL in your web browser to view the application.

## API Endpoint

- `GET /api/titles`: Returns a list of text titles stored in the backend.

## Contributing

Feel free to submit issues or pull requests for improvements or bug fixes.# no_code_decisiontree_classifier_app
