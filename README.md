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

The input is a list of files **in an extension directory** (see "Input format"
below for more details).
The output is the input excluding lines that did not match the filter as given
in the command-line arguments. The results can be piped to combine filters.

### Examples

```
# Note: "ls -ONE D", not "ls -EL D" - see "All extension directories" below.
ls -1d /mnt/ebs/unzipped/1/*/*/*/*/ > initialinput

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
directories using: `ls -1d */*`

When the network share is used, extensions are at
`/mnt/ebs/unzipped/ 1 / <digits> / <single digit> / <digits> / <digits> /`.
Enter the `ebs` directory and list all extension directories using:

```
ls -1d unzipped/1/*/*/*/*/
```

The `-1` ensures that each directory path is output to 1 line.  
The `-d` ensures that directories are printed as-is, and not their content.

