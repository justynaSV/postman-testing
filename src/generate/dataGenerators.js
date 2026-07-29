/**
 * Reusable "Pre-request Script" data generators (random VIN, random
 * customer, random suffixed test name, ...), based on the team's existing
 * hand-written Postman pre-request scripts. These aren't derived from the
 * OpenAPI schema at all - they're opt-in snippets a user can attach to a
 * generated request (or just copy standalone) to seed `pm.collectionVariables`
 * with realistic random test data before a request runs.
 */

const VIN_SCRIPT = `function generateVIN() {
    const characters = 'ABCDEFGHJKLMNPRSTUVWXYZ0123456789';
    let vin = '';
    for (let i = 0; i < 17; i++) {
        vin += characters.charAt(Math.floor(Math.random() * characters.length));
    }
    return vin;
}
    
const vin = generateVIN();
pm.collectionVariables.set('vin', vin);`;

const CUSTOMER_SCRIPT = `// Arrays for generating names
const firstNames = [
    "Adam", "Anna", "Piotr", "Maria", "Tomasz", "Katarzyna", "Marcel", "Marzena",
    "Jan", "Agnieszka", "Justyna", "Barbara", "Krzysztof", "Ewa", "Andrzej", "Zofia",
    "Marek", "Elżbieta", "Marcin", "Magdalena", "Krystyna", "Grzegorz", "Monika"
];
const lastNames = [
    "Nowak", "Kowalski", "Wiśniewski", "Wójcik", "Kowalczyk", "Kamiński",
    "Lewandowski", "Zieliński", "Szymański", "Woźniak", "Dąbrowski", "Piórkowski",
    "Jankowski", "Mazur", "Kwiatkowski", "Krawczyk", "Piotrowski", "Grabowski"
];

// Function to get random element from array
function getRandomElement(array) {
    return array[Math.floor(Math.random() * array.length)];
}

const firstName = getRandomElement(firstNames);
const lastName = getRandomElement(lastNames);
pm.collectionVariables.set('firstName', firstName);
pm.collectionVariables.set('lastName', lastName);

// Function to generate random number of specified length
function generateRandomNumber(length) {
    let result = '';
    for (let i = 0; i < length; i++) {
        result += Math.floor(Math.random() * 10);
    }
    return result;
}

// Function to generate email from name
function generateEmail(firstName, lastName) {
    // Remove diacritics
    const normalizedFirstName = firstName.normalize("NFD").replace(/[\\u0300-\\u036f]/g, "").toLowerCase();
    const normalizedLastName = lastName.normalize("NFD").replace(/[\\u0300-\\u036f]/g, "").toLowerCase();
    const domain = "test.pl";

    // Generate random number to make email unique
    const randomNum = Math.floor(Math.random() * 1000);

    return \`\${normalizedFirstName}.\${normalizedLastName}\${randomNum}@\${domain}\`;
}

let customerEmail = generateEmail(firstName, lastName);
pm.collectionVariables.set('customerEmail', customerEmail);

// Function to generate phone number (Polish format)
function generatePhoneNumber() {
    return \`\${generateRandomNumber(9)}\`;
}

let number = generatePhoneNumber();
pm.collectionVariables.set('number', number);`;

function buildRandomTestNameScript(params = {}) {
  const variableName = params.variableName || "testName";
  const namePrefix = params.namePrefix || "Test Category";
  const logLabel = params.logLabel || "value";

  return `// Generate a random 3-digit number (001-999)
const randomNum = String(Math.floor(Math.random() * 999) + 1).padStart(3, '0');
// Create the ${logLabel} name
const ${variableName} = \`${namePrefix} \${randomNum}\`;

pm.collectionVariables.set("${variableName}", ${variableName});

console.log(\`Generated ${logLabel}: \${${variableName}}\`);`;
}

const GENERATORS = {
  vin: {
    id: "vin",
    label: "VIN - random 17-character vehicle identification number",
    variables: ["vin"],
    params: [],
    build: () => VIN_SCRIPT,
  },
  customer: {
    id: "customer",
    label: "Customer - random first/last name, email, phone number",
    variables: ["firstName", "lastName", "customerEmail", "number"],
    params: [],
    build: () => CUSTOMER_SCRIPT,
  },
  randomTestName: {
    id: "randomTestName",
    label: 'Random test name with a 3-digit suffix (e.g. "Test Tire Category 042")',
    variables: (params) => [params?.variableName || "testName"],
    params: [
      { name: "variableName", label: "Collection variable name", default: "testName" },
      { name: "namePrefix", label: "Name prefix", default: "Test Category" },
      //{ name: "logLabel", label: "Label used in the console.log message", default: "value" },
    ],
    build: (params) => buildRandomTestNameScript(params),
  },
};

/** Returns metadata (no script bodies) for every available generator, for menus/dropdowns. */
function listGenerators() {
  return Object.values(GENERATORS).map(({ id, label, params }) => ({ id, label, params }));
}

/**
 * Combines one or more generators into a single Pre-request Script.
 * @param {Array<{ id: string, params?: Object }>} selections
 * @returns {string}
 */
function buildPreRequestScript(selections) {
  if (!selections || selections.length === 0) return "";
  const parts = selections.map(({ id, params }) => {
    const generator = GENERATORS[id];
    if (!generator) {
      throw new Error(`Unknown generator "${id}". Available: ${Object.keys(GENERATORS).join(", ")}`);
    }
    return generator.build(params || {});
  });
  return parts.join("\n\n");
}

module.exports = { GENERATORS, listGenerators, buildPreRequestScript };
