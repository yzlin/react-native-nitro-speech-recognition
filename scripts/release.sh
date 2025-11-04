#!/bin/bash

set -e

echo "Starting the release process..."
echo "Provided options: $@"

echo "Publishing 'react-native-nitro-speech-recognition' to NPM"
cd packages/react-native-nitro-speech-recognition
bun release $@

echo "Creating a Git bump commit and GitHub release"
cd ../..
bun run release-it $@

echo "Successfully released Nitro Speech Recognition!"
