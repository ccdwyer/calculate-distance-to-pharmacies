import {Client} from "@googlemaps/google-maps-services-js";
const csv = require('csvtojson');
import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import _chunk from 'lodash/chunk';
import { table } from 'table';

const rl = readline.createInterface({ input, output });
const GOOGLE_MAPS_API_KEY = Bun.env.GOOGLE_MAPS_API_KEY;

interface RawPharmacy {
    "Pharmacy Name": string;
    Address: string;
    City: string;
    State: string;
    ZIP: string;
    DEA: string;
    NPI: string;
    field8: string;
}

interface Pharmacy {
    name: string;
    address: string;
    city: string;
    state: string;
    zip: string;
    dea: string;
    npi: string;
    formattedAddress: string;
}

const loadPharmacies = async () => {
    const file = Bun.file("AdministrationSites.csv");
    const fileText = await file.text();
    const rawPharmacies = (await csv().fromString(fileText)) as RawPharmacy[];

    return rawPharmacies.map((pharmacy) => {
        return {
            name: pharmacy["Pharmacy Name"],
            address: pharmacy.Address,
            city: pharmacy.City,
            state: pharmacy.State,
            zip: pharmacy.ZIP,
            dea: pharmacy.DEA,
            npi: pharmacy.NPI,
            formattedAddress: `${pharmacy.Address}, ${pharmacy.City}, ${pharmacy.State} ${pharmacy.ZIP}`
        }
    });
};

const getPatientAddressInput = async (pharmacies: Pharmacy[]) => {
    const patientState = await rl.question('What is the patient state? (use 2 letter abbreviation)\n');
    if (!pharmacies.some((pharmacy) => pharmacy.state.toUpperCase() === patientState.toUpperCase())) {
        console.log("No pharmacies found in state");
        process.exit(0);
    }
    const patientStreetAddress = await rl.question('What is the patient street address?\n');
    const patientCity = await rl.question('What is the patient city?\n');
    const patientZipCode = await rl.question('What is the patient zip code?\n');

    return {
        patientAddress: `${patientStreetAddress}, ${patientCity}, ${patientState} ${patientZipCode}`,
        patientState
    };
}

const determineClosestPharmacies = async (pharmacies: Pharmacy[], patientAddress: string) => {
    if (!GOOGLE_MAPS_API_KEY) {
        throw new Error("GOOGLE_MAPS_API_KEY is not set");
    }
    
    const client = new Client({});

    const chunkedPharmacies = _chunk(pharmacies, 25);

    try {
        const statePharmacies = [];

        for (const chunk of chunkedPharmacies) {
            const res = await client.distancematrix({
                params: {
                    origins: [patientAddress],
                    destinations: chunk.map((pharmacy) => pharmacy.formattedAddress),
                    key: GOOGLE_MAPS_API_KEY
                },
            });

            const pharmaciesWithDistance = res.data.rows[0].elements.map((element, index) => {
                return {
                    name: chunk[index].name,
                    address: chunk[index].address,
                    dea: chunk[index].dea,
                    npi: chunk[index].npi,
                    distance: element.distance.text,
                    distanceValue: element.distance.value,
                }
            });

            statePharmacies.push(...pharmaciesWithDistance);
        }

        statePharmacies.sort((a, b) => a.distanceValue - b.distanceValue);
        return statePharmacies.slice(0, 5) ?? [];
    } catch (e) {
        console.log("error fetching distance matrix");
    }
};

const getPharmaciesForPatient = async () => {
    const pharmacies = (await loadPharmacies() as Pharmacy[]);
    const { patientAddress, patientState } = await getPatientAddressInput(pharmacies);
    const closestPharmacies = await determineClosestPharmacies(
        pharmacies.filter((pharmacy) => pharmacy.state.toUpperCase() === patientState),
        patientAddress,
    );

    if (!closestPharmacies || closestPharmacies.length === 0) {
        process.exit(0);
    }

    console.log(`The closest pharmacies are:\n`);
    const keys = Object.keys(closestPharmacies[0]);
    console.log(table([keys, ...closestPharmacies.map((pharmacy) => Object.values(pharmacy))]));
    process.exit(0);
}

getPharmaciesForPatient();