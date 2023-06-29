# Spinal Organ Analysis

The Spinal Organ Analysis is a module designed to gather and process analytics from the spinal database. It initiates bindings and computations utilizing the service provided by [Spinal Model Analysis](https://github.com/spinalcom/spinal-model-analysis).

## Getting Started

These instructions will guide you on how to install and make use of the Spinal Organ Analysis.

### Prerequisites

This module requires a `.env` file in the root directory with the following variables:

```bash
USER_ID=                      # The id of the user connecting to the spinalhub
USER_PASSWORD=                # The password of the user connecting to the spinalhub
SPINALHUB_IP=                 # The IP address of the spinalhub
SPINALHUB_PROTOCOL=           # The protocol for connecting to the spinalhub (http or https)
SPINALHUB_PORT=               # The port for connecting to the spinalhub
DIGITALTWIN_PATH=             # The path of the digital twin in the spinalhub
UPDATE_ANALYTIC_QUEUE_TIMER=  # Time (in ms) between each update of the analytic queue
ORGAN_NAME=                   # The name of the organ
REPORT_TIMER=                 # Time (in ms) between each report

TWILIO_SID=                   # The SID of the Twilio account (optional)
TWILIO_TOKEN=                 # The token of the Twilio account (optional)
TWILIO_NUMBER=                # The phone number for sending SMS (optional)

GSERVICE_ACCOUNT_KEY=         # The key of the Google service account (optional)
GSERVICE_ACCOUNT_EMAIL=       # The email of the Google service account (optional)
GSPACE_NAME=                  # The name of the Google Space (optional)
```

### Installation

Clone this repository in the directory of your choice. Navigate to the cloned directory and install the dependencies using the following command:
    
```bash
npm install
```

To build the module, run:

```bash
npm run build
```

### Usage

Start the module with:

```bash
npm run start
```

Or using [pm2](https://pm2.keymetrics.io/docs/usage/quick-start/)
```bash
pm2 start node dist/index.js
```


