# WebExtensions Analysis tools

This repository contains tools to improve the feasibility of analysing large
volumes of extensions.

Authored by Rob Wu (https://robwu.nl). If you have questions, ask Rob.


## Setup

Run `npm install` to install the dependencies.

The tools are in the `bin/` directory. Source `bin/activate` to add the tools
to your PATH for easier access and autocompletion (optional but recommended):

```
. /path/to/this/repo/bin/activate
```


## Usage

`filter` is the main tool, and shorthands are symlinked to it. Usage:

- `... | filter-permissions [comma separated permissions] [more permissions ...]`
- `... | filter-manifest [manifest key] [regexp] [optional more regexps ...]`
- `... | filter-user-count [options such as 1+ or 10- or prepend, see --help]`

The input is a list of files **in an extension directory** (see "Input format"
below for more details).
The output is the input excluding lines that did not match the filter as given
in the command-line arguments. The results can be piped to combine filters.

### Example with webextaware

[`webextaware`](https://github.com/cr/webextaware`) can be used to download all
public extensions from AMO. This requires plenty of disk space, think of 100 GB+.
After downloading and extracting the extensions, create a list of the directory
structure that we can use with the `filter-*` commands.

```
webextaware sync
webextaware unzip all --nooverwrite -o /path/to/extracted
find /path/to/extracted -mindepth 2 -maxdepth 2 > initialinput
```

Optionally, if you want to use `filter-user-count`, prepare `amo_metadata.json` from the `webextaware` cache:

```
bzip2 -kcd ~/.webextaware/amo_metadata.json.bz2 | jq 'map({"id","guid","average_daily_users"})' -c > /tmp/amo_metadata.json
```

`filter-user-count` can be used to select extensions with at least or at most some users, e.g.:

```
cat initialinput | filter-user-count 1000+ > more-than-1k
cat more-than-1k | filter-manifest manifest_version 3 > mv3-1k-plus
```

`filter-user-count prepend` prepends the user count, which can be used to sort by users:

```
cat initialinput | filter-user-count prepend | sort -nr > extensions-sorted-by-users
```

For more options, see `filter-user-count --help`.
For other examples of filtering, see Examples below.


### Examples

```
# Find all matches of: /path/to/extracted
find /path/to/extracted -mindepth 2 -maxdepth 2 > initialinput

# Example: ("cookies" AND "tabs") OR "webNavigation"
cat initialinput | filter-permissions cookies,tabs webNavigation > output

# Example: ("cookies" OR "tabs) AND "webNavigation"
cat initialinput | filter-permissions cookies,webNavigation tabs,webNavigation > output

# Or equivalently with multiple pipes (less efficient, but works):
cat initialinput | filter-permissions cookies tabs | filter-permissions webNavigation > output
```

Because `initialinput` was a list of extension directories, so is the output.
Use other standard tools like `grep` to find file names:

```
# Find all files containing webRequest. Note "-r" for recursive search,
# and "-l" to only list the files without displaying matched text.
cat output | xargs -n1 grep -rl --include='*.js' webRequest > webreqout

# Filter files, find all that use `onBeforeRequest`:
cat webreqout | xargs -n1 grep -l onBeforeRequest > somefilename

# Filter files, find all that do NOT contain `onBeforeRequest`:
cat webreqout | xargs -n1 grep -lv onBeforeRequest > somefilename

# You can also use `filter-*` again, e.g. filter by permissions:
cat webreqout | filter-permissions '<all_urls>' > somefilename
```

Instead of directing stdout to a file (`> somefilename`), you can also use
a pager (e.g. `| less` ) or both (` | tee somefilename | less` ).

If you have found all files that you need, you can cut off the end of the file
path to obtain the extension directory:

```
# Example:
$ cat somefilename
/tmp/mnt/ebs/unzipped/1/123/1/456/789/file.js
/tmp/mnt/ebs/unzipped/1/123/1/456/789/file2.js
/tmp/mnt/ebs/unzipped/1/123/1/456/123/file2.js

$ cat somefilename | cut -d/ -f1-10 | sort | uniq
/tmp/mnt/ebs/unzipped/1/123/1/456/789/
/tmp/mnt/ebs/unzipped/1/123/1/456/123/
```


### Input format

The input must be an extension directory, or any file or subdirectory of it.

The directory must have a very specific format, to ensure that the tool can
efficiently resolve the root of an extension directory without disk access,
for a given file path.

Currently, two formats are supported:

- The directory structure output by the `webextaware unzip` tool.
- The directory structure of the `unzipped` extensions on the network share.

Edit the `getExtensionDirectory` method of the `filter` command if you want to
support more directory formats.

#### Examples: All extension directories

When `webextaware unzip all -o /path/to/extracted` is run, extensions are
extracted to `/path/to/extracted`. Enter this directory, and list all extension
directories using: `find . -mindepth 2 -maxdepth 2`

When the network share is used, extensions are at
`/mnt/ebs/unzipped/ 1 / <digits> / <single digit> / <digits> / <digits> /`.
Enter the `ebs` directory and list all extension directories using:

```
find unzipped/1 -mindepth 5 -maxdepth 5 -type d
```

If the number of directories is small enough to not exceed the maximum number
of command line arguments, then the following can also be used instead:
```
ls -1d unzipped/1/*/*/*/*/
```

The `-1` ensures that each directory path is output to 1 line.  
The `-d` ensures that directories are printed as-is, and not their content.

