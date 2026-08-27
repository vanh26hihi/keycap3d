/**
 * The user's actual printer (Bambu Lab P2S) bed size, mm -- confirmed
 * directly from Bambu Studio's own printer profile for this machine
 * (256 x 256 x 256mm, width x depth x height). Shared by the Viewport's
 * bed-plate visualization and the Legend field's batch-create-per-word
 * grid layout so both agree on the same real usable area instead of each
 * guessing a different number.
 */
export const PRINT_BED_WIDTH_MM = 256;
export const PRINT_BED_DEPTH_MM = 256;
